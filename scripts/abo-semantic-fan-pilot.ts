import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas, ImageData, createCanvas } from '@napi-rs/canvas';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import type { AssemblyComponentIR, AssemblyIR } from '../src/engine/assembly-ir';
import type { GroundTruthCorpusManifest } from '../src/engine/ground-truth-corpus';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { fitDiscreteMultiviewCameras } from '../src/engine/discrete-multiview-camera-fit';
import { fitBoundedPerViewCapturePoseResiduals } from '../src/engine/capture-pose-residual-fit';
import { composeWorldAxisRotation } from '../src/engine/assembly-transform';
import {
  createGeometryRecoveryPlan,
  observeAlignedComponentBounds,
  type GeometryRecoveryAction,
} from '../src/engine/geometry-recovery-plan';
import {
  createBoundedAxisScaleRecoveryTrials,
  createBoundedGroupAxisSpacingTrials,
  executeBoundedGeometryRecoverySearch,
  type GeometryRecoveryEvaluation,
} from '../src/engine/geometry-recovery-executor';
import { auditAssemblyDetail } from '../src/engine/generation-policy';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import { auditPartDecomposition, type PartDecompositionContract } from '../src/engine/part-decomposition';
import { auditVisualPlan, type VisualPlanningContract } from '../src/engine/visual-plan-audit';
import { compareReferenceFrames, compareThinFeatureSilhouettes, type ComparisonFrame } from '../src/engine/reference-comparison';
import { auditMultiviewSilhouetteFidelity } from '../src/engine/silhouette-fidelity';
import { auditSemanticSilhouetteAttribution } from '../src/engine/silhouette-component-attribution';
import { auditSilhouetteResidualLocalization } from '../src/engine/silhouette-residual-localization';
import { auditRigidMultiviewSet } from '../src/engine/multiview-consistency';
import { auditPbrReferenceEvidence } from '../src/engine/pbr-reference-audit';
import {
  applyReferenceMaterialEvidence,
  bindReferenceMaterialFactorEvidence,
  referenceMaterialProvenanceFromExtras,
} from '../src/engine/reference-material-evidence';
import { deriveMaskedReferenceSurface } from '../src/engine/reference-surface';
import { compareSurfaceGeometry, sampleTriangleSurface } from '../src/engine/surface-geometry-fidelity';
import { solidifySilhouetteMask } from '../src/engine/silhouette-mask';
import { normalizedFrame, sha256 } from './lib/visual-capture-frames';
import {
  collectGltfTriangles,
  collectPbrEvidence,
  collectThreeTriangles,
  exportCanonicalGlb,
  silhouetteFrameFromTriangles,
  type SilhouetteCamera,
} from './lib/semantic-product-pilot';

class NodeFileReader {
  result: ArrayBuffer | string | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => { this.result = result; queueMicrotask(() => this.onloadend?.()); });
  }
}

class NodeOffscreenCanvas extends Canvas {
  toBlob(callback: (blob: Blob) => void, type = 'image/png'): void {
    callback(new Blob([new Uint8Array(this.encodeSync(type === 'image/jpeg' ? 'jpeg' : 'png'))], { type }));
  }
  async convertToBlob(options?: { type?: string }): Promise<Blob> {
    const type = options?.type ?? 'image/png';
    return new Blob([new Uint8Array(this.encodeSync(type === 'image/jpeg' ? 'jpeg' : 'png'))], { type });
  }
}

Object.assign(globalThis, { FileReader: NodeFileReader, OffscreenCanvas: NodeOffscreenCanvas, ImageData });

const geometryIterationOnly = process.argv.includes('--geometry-only');
const positionalArgs = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const assetRoot = resolve(positionalArgs[0] ?? 'work/abo/pilot/fan');
const artifactRoot = resolve(positionalArgs[1] ?? 'tmp/abo-semantic-fan');
const outputPath = resolve(positionalArgs[2] ?? (
  geometryIterationOnly
    ? 'benchmarks/abo-semantic-fan-geometry-iteration.json'
    : 'benchmarks/abo-semantic-fan-pilot-latest.json'
));
mkdirSync(artifactRoot, { recursive: true });

const corpusManifest = JSON.parse(readFileSync(resolve('benchmarks/corpora/abo-pilot.json'), 'utf8')) as GroundTruthCorpusManifest;
const corpusCase = corpusManifest.cases.find((item) => item.id === 'abo-industrial-floor-fan');
if (!corpusCase) throw new Error('ABO fan camera evidence is missing from the locked corpus manifest.');

const viewIds = ['front', 'right', 'rear', 'left'] as const;
const viewFiles = ['view-000.jpg', 'view-090.jpg', 'view-180.jpg', 'view-270.jpg'] as const;
const azimuths = [0, 90, 180, 270] as const;
const references = await Promise.all(viewFiles.map((file) => normalizedFrame(resolve(assetRoot, file))));
const imageFingerprints = viewFiles.map((file) => sha256(new Uint8Array(readFileSync(resolve(assetRoot, file)))));
const referenceMaterialSurface = deriveMaskedReferenceSurface(references.map((reference, index) => ({
  id: viewIds[index]!,
  fingerprint: imageFingerprints[index]!,
  width: reference.rawFrame.width,
  height: reference.rawFrame.height,
  rgba: reference.rawFrame.rgba,
  mask: reference.rawFrame.mask!,
})), { textureSize: 128, strength: 0.9, localizedPatch: true });
const resizeFrame = (frame: ComparisonFrame, width: number, height: number): ComparisonFrame => {
  const mask = new Uint8Array(width * height);
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceX = Math.min(frame.width - 1, Math.floor((x + 0.5) * frame.width / width));
    const sourceY = Math.min(frame.height - 1, Math.floor((y + 0.5) * frame.height / height));
    const sourcePixel = sourceY * frame.width + sourceX;
    const targetPixel = y * width + x;
    mask[targetPixel] = frame.mask?.[sourcePixel] ?? 0;
    for (let channel = 0; channel < 4; channel += 1) rgba[targetPixel * 4 + channel] = frame.rgba[sourcePixel * 4 + channel]!;
  }
  return { width, height, rgba, mask };
};
const searchReferences = references.map((reference) => ({
  frame: resizeFrame(reference.frame, 128, 64), rawFrame: resizeFrame(reference.rawFrame, 128, 64),
}));

const blackSteel = {
  color: '#111315', surface: 'coated-metal' as const, roughness: 0.43, metalness: 0.78,
  clearcoat: 0.15, clearcoatRoughness: 0.35, microNormalStrength: 0.1,
};
const blackPolymer = {
  color: '#17191b', surface: 'molded-polymer' as const, roughness: 0.57, metalness: 0.02,
  microNormalStrength: 0.17,
};
const brushedAluminium = {
  color: '#a9aaac', surface: 'brushed-metal' as const, roughness: 0.27, metalness: 0.93,
  anisotropy: 0.72, anisotropyRotation: 0.18, microNormalStrength: 0.22,
};
const rubber = { color: '#090a0b', surface: 'rubber' as const, roughness: 0.9, metalness: 0, microNormalStrength: 0.2 };
const evidence = {
  status: 'estimated' as const,
  source: 'abo-pilot/fan/four-spin-views',
  notes: ['Semantic multi-view reconstruction; hidden interfaces and photometric response remain uncalibrated.'],
};
const component = (
  value: Omit<AssemblyComponentIR, 'category' | 'materialName' | 'detail' | 'evidence'>
    & Partial<Pick<AssemblyComponentIR, 'category' | 'materialName' | 'detail'>>,
): AssemblyComponentIR => ({
  category: 'mechanical', materialName: 'black coated steel',
  detail: 'independently editable evidence-mapped fan part', evidence, ...value,
});

const cageCenterY = 44;
const cageOuterRadius = 220;
const cageFrontZ = -42;
const cageRearZ = 42;
const cageRingRadii = Array.from({ length: 18 }, (_, index) => 38 + index * 9.8);
const spokeAngles = Array.from({ length: 12 }, (_, index) => index * Math.PI / 6);
const components: AssemblyComponentIR[] = [];

for (const [side, z] of [['front', cageFrontZ], ['rear', cageRearZ]] as const) {
  components.push(component({
    id: `cage-${side}-outer`, name: `${side} guard outer rim`,
    geometry: { op: 'torus', radius: cageOuterRadius - 4, tube: 5, radialSegments: 12, tubularSegments: 96 },
    position: [0, cageCenterY, z], material: blackSteel,
  }));
  for (let index = 0; index < cageRingRadii.length; index += 1) {
    components.push(component({
      id: `cage-${side}-ring-${index + 1}`, name: `${side} concentric guard ring ${index + 1}`,
      geometry: { op: 'torus', radius: cageRingRadii[index]!, tube: 1.45, radialSegments: 6, tubularSegments: 72 },
      position: [0, cageCenterY, z], material: blackSteel,
    }));
  }
  for (let index = 0; index < spokeAngles.length; index += 1) {
    const angle = spokeAngles[index]!;
    components.push(component({
      id: `cage-${side}-spoke-${index + 1}`, name: `${side} radial guard spoke ${index + 1}`,
      geometry: {
        op: 'tube',
        points: [[Math.cos(angle) * 28, cageCenterY + Math.sin(angle) * 28, z],
          [Math.cos(angle) * 217, cageCenterY + Math.sin(angle) * 217, z]],
        radius: 1.85, tubularSegments: 18, radialSegments: 6,
      },
      material: blackSteel,
    }));
  }
}

components.push(
  component({
    id: 'cage-depth-rim', name: 'guard perimeter depth ring',
    geometry: { op: 'torus', radius: cageOuterRadius, tube: 4.5, radialSegments: 10, tubularSegments: 96 },
    position: [0, cageCenterY, 0], material: blackSteel,
  }),
  component({
    id: 'front-hub-cap', name: 'front branded hub cap', materialName: 'molded polymer',
    geometry: { op: 'cylinder', radiusTop: 40, radiusBottom: 43, depth: 16, radialSegments: 48 },
    position: [0, cageCenterY, -55], rotation: [Math.PI / 2, 0, 0], material: blackPolymer,
  }),
  component({
    id: 'blade-spider', name: 'blade carrier',
    geometry: { op: 'cylinder', radiusTop: 33, radiusBottom: 38, depth: 30, radialSegments: 40 },
    position: [0, cageCenterY, -13], rotation: [Math.PI / 2, 0, 0], material: blackSteel,
  }),
);

const bladePoints: Array<[number, number]> = [
  [24, -15], [78, -37], [153, -47], [188, -28], [175, 9], [117, 39], [55, 34], [24, 17],
];
for (let index = 0; index < 3; index += 1) {
  components.push(component({
    id: `blade-${index + 1}`, name: `brushed aluminium blade ${index + 1}`, materialName: 'brushed aluminium',
    geometry: {
      op: 'extrude', points: bladePoints, depth: 8, bevelSize: 2.2, bevelThickness: 1.5, bevelSegments: 2,
    },
    position: [0, cageCenterY, -24], rotation: [0, 0, index * Math.PI * 2 / 3 + 0.18],
    material: brushedAluminium,
  }));
}

components.push(
  component({
    id: 'motor-shell', name: 'rear motor housing', category: 'power', materialName: 'molded polymer',
    geometry: { op: 'cylinder', radiusTop: 62, radiusBottom: 68, depth: 106, radialSegments: 48 },
    position: [0, cageCenterY, 94], rotation: [Math.PI / 2, 0, 0], material: blackPolymer,
  }),
  component({
    id: 'motor-rear-cap', name: 'vented rear motor cap', category: 'power', materialName: 'molded polymer',
    geometry: { op: 'cylinder', radiusTop: 55, radiusBottom: 60, depth: 14, radialSegments: 48 },
    position: [0, cageCenterY, 153], rotation: [Math.PI / 2, 0, 0], material: blackPolymer,
  }),
);

for (let index = 0; index < 14; index += 1) {
  const angle = index * Math.PI * 2 / 14;
  const x0 = Math.cos(angle) * 31;
  const y0 = cageCenterY + Math.sin(angle) * 31;
  const x1 = Math.cos(angle) * 51;
  const y1 = cageCenterY + Math.sin(angle) * 51;
  components.push(component({
    id: `motor-vent-${index + 1}`, name: `rear motor vent ${index + 1}`, category: 'power',
    geometry: { op: 'tube', points: [[x0, y0, 161], [x1, y1, 161]], radius: 2.4, tubularSegments: 5, radialSegments: 6 },
    material: blackSteel,
  }));
}

components.push(
  component({
    id: 'switch-post', name: 'speed control support post', category: 'power', materialName: 'molded polymer',
    geometry: { op: 'roundedBox', size: [28, 104, 34], radius: 6, segments: 5 },
    position: [0, 160, 112], material: blackPolymer,
  }),
  component({
    id: 'switch-box', name: 'three-speed switch enclosure', category: 'power', materialName: 'molded polymer',
    geometry: { op: 'roundedBox', size: [82, 64, 45], radius: 7, segments: 6 },
    position: [0, 205, 120], material: blackPolymer,
  }),
  component({
    id: 'speed-knob', name: 'speed selector knob', category: 'power', materialName: 'molded polymer',
    geometry: { op: 'cylinder', radiusTop: 17, radiusBottom: 17, depth: 17, radialSegments: 24 },
    position: [0, 205, 151], rotation: [Math.PI / 2, 0, 0], material: blackPolymer,
  }),
  component({
    id: 'pivot-left', name: 'left tilt pivot',
    geometry: { op: 'cylinder', radiusTop: 18, radiusBottom: 18, depth: 23, radialSegments: 28 },
    position: [-224, cageCenterY, 0], rotation: [0, 0, Math.PI / 2], material: blackPolymer,
  }),
  component({
    id: 'pivot-right', name: 'right tilt pivot',
    geometry: { op: 'cylinder', radiusTop: 18, radiusBottom: 18, depth: 23, radialSegments: 28 },
    position: [224, cageCenterY, 0], rotation: [0, 0, Math.PI / 2], material: blackPolymer,
  }),
  component({
    id: 'stand-left', name: 'left bent support rail',
    geometry: { op: 'tube', points: [[-224, cageCenterY, 0], [-247, -154, 0], [-250, -226, -8], [-244, -245, -20]], radius: 8.5, tubularSegments: 32, radialSegments: 10 },
    material: blackSteel,
  }),
  component({
    id: 'stand-right', name: 'right bent support rail',
    geometry: { op: 'tube', points: [[224, cageCenterY, 0], [247, -154, 0], [250, -226, -8], [244, -245, -20]], radius: 8.5, tubularSegments: 32, radialSegments: 10 },
    material: blackSteel,
  }),
  component({
    id: 'base-front-rail', name: 'front base rail',
    geometry: { op: 'tube', points: [[-244, -245, -20], [-120, -250, -26], [0, -251, -30], [120, -250, -26], [244, -245, -20]], radius: 8.5, tubularSegments: 40, radialSegments: 10 },
    material: blackSteel,
  }),
  component({
    id: 'base-rear-rail', name: 'rear stabilizer rail',
    geometry: { op: 'tube', points: [[-205, -246, 212], [0, -248, 215], [205, -246, 212]], radius: 5, tubularSegments: 32, radialSegments: 10 },
    material: blackSteel,
  }),
  component({
    id: 'base-left-link', name: 'left base depth link',
    geometry: { op: 'tube', points: [[-244, -245, -20], [-268, -246, 98], [-205, -246, 212]], radius: 5, tubularSegments: 28, radialSegments: 10 },
    material: blackSteel,
  }),
  component({
    id: 'base-right-link', name: 'right base depth link',
    geometry: { op: 'tube', points: [[244, -245, -20], [268, -246, 98], [205, -246, 212]], radius: 5, tubularSegments: 28, radialSegments: 10 },
    material: blackSteel,
  }),
);

for (const [id, position] of [
  ['foot-left-front', [-244, -260, -20]], ['foot-right-front', [244, -260, -20]],
  ['foot-left-rear', [-205, -260, 212]], ['foot-right-rear', [205, -260, 212]],
] as Array<[string, [number, number, number]]>) {
  components.push(component({
    id, name: id.replaceAll('-', ' '), materialName: 'rubber foot',
    geometry: { op: 'roundedBox', size: [28, 25, 22], radius: 4, segments: 4 }, position, material: rubber,
  }));
}

components.push(
  component({
    id: 'power-cable', name: 'power cable', category: 'interconnect', materialName: 'rubber cable',
    geometry: {
      op: 'tube', points: [[12, cageCenterY, 158], [32, -36, 180], [45, -152, 215], [85, -245, 282],
        [148, -259, 305], [172, -270, 322], [155, -273, 337], [95, -270, 326]],
      radius: 3.3, tubularSegments: 54, radialSegments: 8,
    }, material: rubber,
  }),
  component({
    id: 'power-plug', name: 'two-prong power plug', category: 'interconnect', materialName: 'molded rubber',
    geometry: { op: 'roundedBox', size: [42, 22, 21], radius: 4, segments: 4 },
    position: [72, -270, 326], rotation: [0, 0, -0.15], material: rubber,
  }),
);

const decomposition: PartDecompositionContract = {
  schema: 'morphloom.part-decomposition/0.1',
  assetName: 'ABO industrial floor fan semantic reconstruction',
  sourceViewIds: [...viewIds],
  features: [
    { id: 'double-guard', label: 'front and rear guard shells', kind: 'layered-stack', required: true, evidenceRef: 'four-spin/guard-depth', evidenceStatus: 'estimated', sourceViewIds: [...viewIds], componentIds: ['cage-front-outer', 'cage-rear-outer', 'cage-depth-rim'], minimumCount: 3, geometryRequirement: 'layered-parts' },
    { id: 'concentric-rings', label: 'dense concentric wire rings on both guards', kind: 'repeated-array', required: true, evidenceRef: 'front+rear/concentric-rings', evidenceStatus: 'estimated', sourceViewIds: ['front', 'rear'], componentIds: components.filter((entry) => /cage-(front|rear)-ring/.test(entry.id)).map((entry) => entry.id), minimumCount: cageRingRadii.length * 2, geometryRequirement: 'repeat-set' },
    { id: 'radial-spokes', label: 'radial wire spokes on both guards', kind: 'thin-feature', required: true, evidenceRef: 'four-spin/radial-spokes', evidenceStatus: 'estimated', sourceViewIds: [...viewIds], componentIds: components.filter((entry) => /cage-(front|rear)-spoke/.test(entry.id)).map((entry) => entry.id), minimumCount: spokeAngles.length * 2, geometryRequirement: 'slender' },
    { id: 'three-blades', label: 'three independent metal blades', kind: 'repeated-array', required: true, evidenceRef: 'front+rear/blades', evidenceStatus: 'estimated', sourceViewIds: ['front', 'rear'], componentIds: ['blade-1', 'blade-2', 'blade-3'], minimumCount: 3, geometryRequirement: 'repeat-set', observedCounts: [{ sourceViewId: 'front', count: 3, method: 'external-vision' }, { sourceViewId: 'rear', count: 3, method: 'external-vision' }] },
    { id: 'hub-stack', label: 'front hub cap and blade carrier', kind: 'layered-stack', required: true, evidenceRef: 'front/hub', evidenceStatus: 'estimated', sourceViewIds: ['front', 'right', 'left'], componentIds: ['front-hub-cap', 'blade-spider'], minimumCount: 2, geometryRequirement: 'layered-parts' },
    { id: 'motor-stack', label: 'rear motor shell and vent cap', kind: 'layered-stack', required: true, evidenceRef: 'rear/motor', evidenceStatus: 'estimated', sourceViewIds: ['right', 'rear', 'left'], componentIds: ['motor-shell', 'motor-rear-cap'], minimumCount: 2, geometryRequirement: 'layered-parts' },
    { id: 'motor-vents', label: 'rear radial motor ventilation slots', kind: 'repeated-array', required: true, evidenceRef: 'rear/motor-vents', evidenceStatus: 'estimated', sourceViewIds: ['rear'], componentIds: components.filter((entry) => entry.id.startsWith('motor-vent-')).map((entry) => entry.id), minimumCount: 14, geometryRequirement: 'repeat-set' },
    { id: 'speed-control', label: 'rear switch box, support and rotary knob', kind: 'interface', required: true, evidenceRef: 'rear+side/speed-control', evidenceStatus: 'estimated', sourceViewIds: ['right', 'rear', 'left'], componentIds: ['switch-post', 'switch-box', 'speed-knob'], minimumCount: 3, geometryRequirement: 'separate-part' },
    { id: 'tilt-pivots', label: 'paired side tilt pivots', kind: 'articulation', required: true, evidenceRef: 'four-spin/pivots', evidenceStatus: 'estimated', sourceViewIds: [...viewIds], componentIds: ['pivot-left', 'pivot-right'], minimumCount: 2, geometryRequirement: 'articulated-parts' },
    { id: 'support-frame', label: 'bent support frame and depth-stable base', kind: 'primary-mass', required: true, evidenceRef: 'four-spin/support-base', evidenceStatus: 'estimated', sourceViewIds: [...viewIds], componentIds: ['stand-left', 'stand-right', 'base-front-rail', 'base-rear-rail', 'base-left-link', 'base-right-link'], minimumCount: 6, geometryRequirement: 'separate-part' },
    { id: 'rubber-feet', label: 'four independent support feet', kind: 'repeated-array', required: true, evidenceRef: 'four-spin/base-feet', evidenceStatus: 'estimated', sourceViewIds: [...viewIds], componentIds: ['foot-left-front', 'foot-right-front', 'foot-left-rear', 'foot-right-rear'], minimumCount: 4, geometryRequirement: 'repeat-set' },
    { id: 'cable-route', label: 'routed mains cable', kind: 'routed-element', required: true, evidenceRef: 'four-spin/cable-route', evidenceStatus: 'estimated', sourceViewIds: [...viewIds], componentIds: ['power-cable'], minimumCount: 1, geometryRequirement: 'routed-curve' },
    { id: 'power-plug', label: 'separate two-prong power plug body', kind: 'primary-mass', required: true, evidenceRef: 'four-spin/power-plug', evidenceStatus: 'estimated', sourceViewIds: [...viewIds], componentIds: ['power-plug'], minimumCount: 1, geometryRequirement: 'separate-part' },
  ],
  relationships: [
    { id: 'guard-surrounds-blades', fromFeatureId: 'double-guard', toFeatureId: 'three-blades', kind: 'layers-over', evidenceRef: 'four-spin/guard-blades', required: true },
    { id: 'rings-repeat-guard', fromFeatureId: 'concentric-rings', toFeatureId: 'double-guard', kind: 'repeats-around', evidenceRef: 'front+rear/rings', required: true },
    { id: 'spokes-repeat-guard', fromFeatureId: 'radial-spokes', toFeatureId: 'double-guard', kind: 'repeats-around', evidenceRef: 'four-spin/spokes', required: true },
    { id: 'blades-mate-hub', fromFeatureId: 'three-blades', toFeatureId: 'hub-stack', kind: 'mates-with', evidenceRef: 'front/hub', required: true },
    { id: 'motor-mates-hub', fromFeatureId: 'motor-stack', toFeatureId: 'hub-stack', kind: 'mates-with', evidenceRef: 'side/motor-axis', required: true },
    { id: 'control-attaches-motor', fromFeatureId: 'speed-control', toFeatureId: 'motor-stack', kind: 'attached-to', evidenceRef: 'rear/control', required: true },
    { id: 'guard-hinges-frame', fromFeatureId: 'double-guard', toFeatureId: 'tilt-pivots', kind: 'hinges-to', evidenceRef: 'four-spin/pivots', required: true },
    { id: 'pivots-attach-frame', fromFeatureId: 'tilt-pivots', toFeatureId: 'support-frame', kind: 'attached-to', evidenceRef: 'four-spin/frame', required: true },
    { id: 'feet-attach-frame', fromFeatureId: 'rubber-feet', toFeatureId: 'support-frame', kind: 'attached-to', evidenceRef: 'base/feet', required: true },
    { id: 'cable-leaves-motor', fromFeatureId: 'cable-route', toFeatureId: 'motor-stack', kind: 'passes-through', evidenceRef: 'rear/cable', required: true },
    { id: 'plug-attaches-cable', fromFeatureId: 'power-plug', toFeatureId: 'cable-route', kind: 'attached-to', evidenceRef: 'four-spin/plug', required: true },
  ],
};

const repeatedFeatures = decomposition.features.filter((feature) => feature.required && feature.kind === 'repeated-array');
const visualPlan: VisualPlanningContract = {
  schema: 'morphloom.visual-plan/0.1',
  assetName: decomposition.assetName,
  sourceViews: viewIds.map((id, index) => ({
    id,
    kind: 'photo',
    fingerprint: sha256(new Uint8Array(readFileSync(resolve(assetRoot, viewFiles[index]!)))),
  })),
  features: decomposition.features.map((feature) => ({
    id: feature.id,
    label: feature.label,
    kind: feature.kind,
    required: feature.required,
    evidenceStatus: feature.evidenceStatus,
    sourceViewIds: [...feature.sourceViewIds],
    minimumCount: feature.minimumCount,
    observedCounts: feature.observedCounts?.map((item) => ({ sourceViewId: item.sourceViewId, count: item.count }))
      ?? [{ sourceViewId: feature.sourceViewIds[0]!, count: feature.minimumCount }],
    componentIds: [...feature.componentIds],
    separatelyEditable: feature.required,
  })),
  countDeclarations: repeatedFeatures.flatMap((feature) => ([
    { id: `${feature.id}-target`, featureId: feature.id, source: 'quality-target' as const, count: feature.componentIds.length },
    { id: `${feature.id}-repeat`, featureId: feature.id, source: 'repetition-system' as const, count: feature.componentIds.length },
    { id: `${feature.id}-inventory`, featureId: feature.id, source: 'component-inventory' as const, count: feature.componentIds.length },
  ])),
  qualityFloors: {
    detailInventoryMinimum: decomposition.features.length,
    minimumVisualScore: 80,
    referencePbrRequiredWhenSourceImagePresent: true,
    renderedPreviewRequired: true,
    realExportRequired: true,
  },
  surfaceFidelityRequested: true,
  openUnknownIds: ['exact-scale', 'calibrated-camera-poses', 'hidden-interfaces', 'measured-photometry'],
};

const ir: AssemblyIR = {
  schema: 'morphloom.assembly/0.1', name: decomposition.assetName, units: 'mm', components,
  partDecomposition: decomposition,
  visualPlan,
  metadata: {
    assetKind: 'product', qualityTarget: 'semi-professional-editable', evidenceDeliveryReady: false,
    evidenceUnresolvedCapabilities: 'calibrated camera poses, hidden interfaces, measured photometry',
    fidelityContractRequired: true, partDecompositionRequired: true, visualPlanRequired: true,
    benchmarkSource: 'amazon-berkeley-objects',
  },
};

function rotateHeadPointAroundPivot(point: [number, number, number], radians: number): [number, number, number] {
  const relativeY = point[1] - cageCenterY;
  return [
    point[0],
    cageCenterY + relativeY * Math.cos(radians) - point[2] * Math.sin(radians),
    relativeY * Math.sin(radians) + point[2] * Math.cos(radians),
  ];
}

/** Applies the articulation observed consistently in the two side views to every dependent head part. */
function applyObservedHeadTilt(candidate: AssemblyIR, degrees: number): void {
  const radians = degrees * Math.PI / 180;
  const belongsToHead = (id: string) => /^(cage-|front-hub|blade-|blade-spider|motor-|switch-|speed-knob)/.test(id);
  for (const entry of candidate.components.filter((candidateEntry) => belongsToHead(candidateEntry.id))) {
    if (entry.position) entry.position = rotateHeadPointAroundPivot(entry.position, radians);
    if (entry.geometry.op === 'tube') {
      entry.geometry.points = entry.geometry.points.map((point) => rotateHeadPointAroundPivot(point, radians));
    } else {
      entry.rotation = composeWorldAxisRotation(entry.rotation, [1, 0, 0], radians);
    }
  }
}

function rotateHeadPointAroundYawPivot(point: [number, number, number], radians: number): [number, number, number] {
  return [
    point[0] * Math.cos(radians) + point[2] * Math.sin(radians),
    point[1],
    -point[0] * Math.sin(radians) + point[2] * Math.cos(radians),
  ];
}

/**
 * Applies an inferred whole-capture azimuth residual without changing the
 * delivered neutral assembly. This is a diagnostic camera/exposure transform,
 * not an articulated product edit: every visible component must stay rigid.
 */
function applyObservedCaptureYaw(candidate: AssemblyIR, degrees: number): void {
  const radians = degrees * Math.PI / 180;
  for (const entry of candidate.components) {
    if (entry.position) entry.position = rotateHeadPointAroundYawPivot(entry.position, radians);
    if (entry.geometry.op === 'tube') {
      entry.geometry.points = entry.geometry.points.map((point) => rotateHeadPointAroundYawPivot(point, radians));
    } else {
      entry.rotation = composeWorldAxisRotation(entry.rotation, [0, 1, 0], radians);
    }
  }
}

const normalizeAzimuth = (degrees: number) => ((degrees % 360) + 360) % 360;
const referenceDensities = references.map((reference) => reference.rawFrame.mask!
  .reduce((sum, value) => sum + value, 0) / reference.rawFrame.mask!.length);
const referenceMode = Math.max(...referenceDensities) <= 0.12
  ? 'sparse-structure' : Math.max(...referenceDensities) <= 0.25 ? 'hybrid-structure' : 'dense-silhouette';
type SilhouetteRender = ReturnType<typeof silhouetteFrameFromTriangles>;
const silhouetteCache = new WeakMap<ReturnType<typeof collectThreeTriangles>, Map<string, SilhouetteRender>>();
const cachedSilhouette = (
  surfaceTriangles: ReturnType<typeof collectThreeTriangles>,
  azimuthDegrees: number,
  width: number,
  height: number,
  camera: SilhouetteCamera,
): SilhouetteRender => {
  let cache = silhouetteCache.get(surfaceTriangles);
  if (!cache) {
    cache = new Map();
    silhouetteCache.set(surfaceTriangles, cache);
  }
  const key = `${azimuthDegrees}|${width}x${height}|${camera.projection ?? 'orthographic'}|${camera.elevationDegrees ?? 0}|${camera.distanceMultiplier ?? 4}`;
  let render = cache.get(key);
  if (!render) {
    render = silhouetteFrameFromTriangles(surfaceTriangles, azimuthDegrees, width, height, camera);
    cache.set(key, render);
  }
  return render;
};
const scoreView = (
  surfaceTriangles: ReturnType<typeof collectThreeTriangles>,
  index: number,
  azimuthDegrees: number,
  camera: SilhouetteCamera = {},
  referenceSet: Array<{ frame: ComparisonFrame; rawFrame: ComparisonFrame }> = references,
) => {
  const reference = referenceSet[index]!;
  const renderAzimuthDegrees = normalizeAzimuth(azimuthDegrees);
  const render = cachedSilhouette(surfaceTriangles, renderAzimuthDegrees,
    reference.frame.width, reference.frame.height, camera);
  const massRender = {
    ...render,
    mask: solidifySilhouetteMask(render.mask!, render.width, render.height).mask,
  };
  const upperHeight = Math.round(reference.frame.height * 0.76);
  const comparison = compareReferenceFrames(reference.frame, massRender, [{
    featureId: 'cage-and-motor', x: 0, y: 0, width: reference.frame.width, height: upperHeight,
  }]);
  const thinFeature = compareThinFeatureSilhouettes(reference.rawFrame, render, 4);
  const wholeIoU = comparison.silhouetteIoU;
  const primaryMassIoU = comparison.regions[0]!.silhouetteIoU;
  const gateMargin = referenceMode === 'dense-silhouette' ? wholeIoU - 0.75
    : referenceMode === 'hybrid-structure'
      ? Math.min(wholeIoU - 0.7, primaryMassIoU - 0.7, thinFeature.score - 0.8)
      : Math.min(primaryMassIoU - 0.7, thinFeature.score - 0.8);
  return {
    id: viewIds[index]!, source: viewFiles[index]!, evidenceAzimuthDegrees: azimuths[index]!,
    renderAzimuthDegrees, referenceDensity: referenceDensities[index]!, wholeIoU,
    primaryMassIoU, thinFeature, gateMargin, camera,
  };
};
const scoreOffset = (
  surfaceTriangles: ReturnType<typeof collectThreeTriangles>,
  offsetDegrees: number,
  referenceSet: Array<{ frame: ComparisonFrame; rawFrame: ComparisonFrame }> = references,
) => {
  const views = references.map((_, index) => scoreView(
    surfaceTriangles, index, azimuths[index]! + offsetDegrees, {}, referenceSet,
  ));
  const audit = auditMultiviewSilhouetteFidelity(views.map((view) => ({
    id: view.id, referenceDensity: view.referenceDensity, wholeIoU: view.wholeIoU,
    primaryMassIoU: view.primaryMassIoU, thinFeatureScore: view.thinFeature.score,
  })), { wholeIoU: 0.75, primaryMassIoU: 0.7, thinFeatureScore: 0.8 });
  const gateMargin = audit.mode === 'dense-silhouette'
    ? audit.minimumWholeIoU - audit.thresholds.wholeIoU
    : audit.mode === 'hybrid-structure'
      ? Math.min(audit.minimumWholeIoU - audit.thresholds.hybridWholeIoU,
        audit.minimumPrimaryMassIoU - audit.thresholds.primaryMassIoU,
        audit.minimumThinFeatureScore - audit.thresholds.thinFeatureScore)
      : Math.min(audit.minimumPrimaryMassIoU - audit.thresholds.primaryMassIoU,
        audit.minimumThinFeatureScore - audit.thresholds.thinFeatureScore);
  return { offsetDegrees, views, audit, gateMargin };
};

const articulationCandidates = (geometryIterationOnly ? [-4] : [-8, -4, 0, 4, 8]).map((headTiltDegrees) => {
  const candidateIr = structuredClone(ir);
  if (headTiltDegrees !== 0) applyObservedHeadTilt(candidateIr, headTiltDegrees);
  const candidateBuild = compileAssemblyIR(candidateIr, 'beauty');
  const surfaceTriangles = collectThreeTriangles(candidateBuild.root);
  const coarseCalibration = Array.from({ length: geometryIterationOnly ? 1 : 15 }, (_, index) => scoreOffset(
    surfaceTriangles, index * 24, searchReferences,
  ));
  coarseCalibration.sort((left, right) => right.gateMargin - left.gateMargin
    || right.audit.minimumWholeIoU - left.audit.minimumWholeIoU);
  return { headTiltDegrees, ir: candidateIr, build: candidateBuild, surfaceTriangles, coarseCalibration };
});
articulationCandidates.sort((left, right) => right.coarseCalibration[0]!.gateMargin - left.coarseCalibration[0]!.gateMargin
  || right.coarseCalibration[0]!.audit.minimumWholeIoU - left.coarseCalibration[0]!.audit.minimumWholeIoU);
const selectedArticulation = articulationCandidates[0]!;
const observedHeadTiltDegrees = selectedArticulation.headTiltDegrees;
const selectedIr = selectedArticulation.ir;
const build = selectedArticulation.build;
const candidateSurfaceTriangles = selectedArticulation.surfaceTriangles;
const coarseCalibration = selectedArticulation.coarseCalibration;
const cameraCandidates: SilhouetteCamera[] = [
  { projection: 'orthographic', elevationDegrees: 0 },
  { projection: 'perspective', elevationDegrees: 0, distanceMultiplier: 2.25 },
  { projection: 'perspective', elevationDegrees: 0, distanceMultiplier: 3.5 },
  { projection: 'perspective', elevationDegrees: -6, distanceMultiplier: 3.5 },
  { projection: 'perspective', elevationDegrees: 6, distanceMultiplier: 3.5 },
];
const cameraModelId = (camera: SilhouetteCamera): string => [
  camera.projection ?? 'orthographic',
  `e${camera.elevationDegrees ?? 0}`,
  `d${camera.distanceMultiplier ?? 4}`,
].join('-').replaceAll('.', '_');
const iterationOffsetDegrees = selectedArticulation.coarseCalibration[0]!.offsetDegrees;
const iterationCamera = { projection: 'orthographic', elevationDegrees: 0 } as SilhouetteCamera;
const refinementOffsets = geometryIterationOnly
  ? [iterationOffsetDegrees]
  : Array.from({ length: 13 }, (_, index) => normalizeAzimuth(iterationOffsetDegrees - 12 + index * 2));
const perViewScores = references.map((_, viewIndex) => geometryIterationOnly
  ? [scoreView(candidateSurfaceTriangles, viewIndex, azimuths[viewIndex]! + iterationOffsetDegrees,
    iterationCamera, searchReferences)]
  : refinementOffsets.flatMap((offsetDegrees) => cameraCandidates.map((camera) => scoreView(
    candidateSurfaceTriangles, viewIndex, azimuths[viewIndex]! + offsetDegrees, camera, searchReferences,
  ))));
const cameraFit = fitDiscreteMultiviewCameras(perViewScores.map((scores, index) => ({
  id: viewIds[index]!,
  candidates: scores.map((score) => ({
    azimuthDegrees: score.renderAzimuthDegrees, gateMargin: score.gateMargin,
    wholeIoU: score.wholeIoU, primaryMassIoU: score.primaryMassIoU,
    thinFeatureScore: score.thinFeature.score, cameraModelId: cameraModelId(score.camera),
  })),
})), {
  minimumStepDegrees: 40,
  maximumStepDegrees: 140,
  maximumStepDeviationDegrees: 0,
  requireSharedCameraModel: true,
  poseEvidence: {
    contract: corpusCase.cameraPoseEvidence,
    expectedSourceFingerprints: Object.fromEntries(viewIds.map((id, index) => [id, imageFingerprints[index]!])),
  },
});
if (cameraFit.views.length !== references.length) {
  throw new Error(`Evidence-constrained camera fit failed: ${cameraFit.blockers.join('; ')}`);
}
const selectedCameras = cameraFit.views.map((selection, index) => {
  const searchSelection = perViewScores[index]!
    .find((score) => score.renderAzimuthDegrees === selection.candidate.azimuthDegrees
      && cameraModelId(score.camera) === selection.candidate.cameraModelId)!;
  return searchSelection.camera;
});
const yawCandidates = Array.from({ length: 37 }, (_, index) => -90 + index * 5);
const capturePoseCandidates = cameraFit.views.map((selection, index) => yawCandidates.map((residualDegrees) => {
  const posedIr = structuredClone(selectedIr);
  if (residualDegrees !== 0) applyObservedCaptureYaw(posedIr, residualDegrees);
  const posedBuild = compileAssemblyIR(posedIr, 'beauty');
  const triangles = collectThreeTriangles(posedBuild.root);
  const score = scoreView(triangles, index, selection.candidate.azimuthDegrees,
    selectedCameras[index]!, references);
  return {
    stateId: residualDegrees < 0 ? `yaw-neg-${Math.abs(residualDegrees)}` : `yaw-${residualDegrees}`,
    residualDegrees, score,
  };
}));
const capturePoseResidualFit = fitBoundedPerViewCapturePoseResiduals(
  capturePoseCandidates.map((candidates, index) => ({
    id: viewIds[index]!, lockedStateId: 'yaw-0', evidenceStatus: 'inferred' as const,
    candidates: candidates.map((candidate) => ({
      stateId: candidate.stateId, residualDegrees: candidate.residualDegrees,
      gateMargin: candidate.score.gateMargin, wholeIoU: candidate.score.wholeIoU,
      primaryMassIoU: candidate.score.primaryMassIoU,
      thinFeatureScore: candidate.score.thinFeature.score,
    })),
  })),
  { minimumGateImprovement: 0.01, maximumAbsoluteResidualDegrees: 90, requirePositiveMargin: false },
);
const selectedCaptureViews = capturePoseResidualFit.views.map((selection, index) => {
  const candidate = capturePoseCandidates[index]!
    .find((item) => item.stateId === selection.selected.stateId)!;
  const posedIr = structuredClone(selectedIr);
  if (candidate.residualDegrees !== 0) applyObservedCaptureYaw(posedIr, candidate.residualDegrees);
  const posedBuild = compileAssemblyIR(posedIr, 'beauty');
  return { ...candidate, posedBuild, triangles: collectThreeTriangles(posedBuild.root) };
});
const fittedViews = selectedCaptureViews.map((selection) => selection.score);
const fittedAudit = auditMultiviewSilhouetteFidelity(fittedViews.map((view) => ({
  id: view.id, referenceDensity: view.referenceDensity, wholeIoU: view.wholeIoU,
  primaryMassIoU: view.primaryMassIoU, thinFeatureScore: view.thinFeature.score,
})), { wholeIoU: 0.75, primaryMassIoU: 0.7, thinFeatureScore: 0.8 });
const semanticSilhouetteAttribution = auditSemanticSilhouetteAttribution(
  cameraFit.views.map((selection, index) => {
    const reference = references[index]!;
    const camera = selectedCameras[index]!;
    const candidateMask = cachedSilhouette(selectedCaptureViews[index]!.triangles, selection.candidate.azimuthDegrees,
      reference.frame.width, reference.frame.height, camera).mask!;
    return {
      id: viewIds[index]!, width: reference.frame.width, height: reference.frame.height,
      referenceMask: reference.frame.mask!, candidateMask,
      weight: 1 + Math.max(0, 0.7 - fittedViews[index]!.wholeIoU) * 4,
      groups: visualPlan.features.map((feature) => {
        const removedIds = new Set(feature.componentIds);
        const ablatedRoot = selectedCaptureViews[index]!.posedBuild.root.clone(true);
        const removedObjects: THREE.Object3D[] = [];
        ablatedRoot.traverse((object) => {
          if (removedIds.has(object.name)) removedObjects.push(object);
        });
        for (const object of removedObjects) object.removeFromParent();
        return {
          groupId: feature.id,
          candidateWithoutGroupMask: silhouetteFrameFromTriangles(
            collectThreeTriangles(ablatedRoot), selection.candidate.azimuthDegrees,
            reference.frame.width, reference.frame.height, camera,
          ).mask!,
        };
      }),
    };
  }),
  { minimumActionableDeltaIoU: 0.001 },
);
const calibration = { views: fittedViews, audit: fittedAudit, gateMargin: cameraFit.minimumGateMargin };
const visualPlanAudit = auditVisualPlan(visualPlan);
const artifactPath = resolve(artifactRoot, 'abo-industrial-floor-fan-semantic.glb');

const nodeIo = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const groundTruthPath = resolve(assetRoot, 'ground-truth.glb');
const groundTruthFingerprint = sha256(new Uint8Array(readFileSync(groundTruthPath)));
const groundTruthDocument = await nodeIo.read(groundTruthPath);
const groundTruthTriangles = collectGltfTriangles(groundTruthDocument);
const referenceSample = sampleTriangleSurface(groundTruthTriangles, 4_096);
const candidateSample = sampleTriangleSurface(candidateSurfaceTriangles, 4_096);
const geometryAudit = compareSurfaceGeometry(referenceSample.points, candidateSample.points);
build.root.updateMatrixWorld(true);
const componentEvidence = new Map(selectedIr.components.map((component) => [component.id, component.evidence?.status ?? 'inferred']));
const componentSpatialObservations = build.root.children.flatMap((object) => {
  if (!(object instanceof THREE.Mesh) || !componentEvidence.has(object.name)) return [];
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return [];
  return [observeAlignedComponentBounds(object.name, {
    minimum: bounds.min.toArray() as [number, number, number],
    maximum: bounds.max.toArray() as [number, number, number],
  }, componentEvidence.get(object.name)!, geometryAudit)];
});
const geometryRecoveryPlan = createGeometryRecoveryPlan(
  geometryAudit,
  visualPlan,
  componentSpatialObservations,
  { maximumActions: 12 },
);

const clampUnit = (value: number): number => Math.max(0, Math.min(1, value));
const evaluateRecoveryCandidate = async (candidateIr: AssemblyIR): Promise<GeometryRecoveryEvaluation> => {
  const candidateBuild = compileAssemblyIR(candidateIr, 'beauty');
  const triangles = collectThreeTriangles(candidateBuild.root);
  const sample = sampleTriangleSurface(triangles, 4_096);
  const audit = compareSurfaceGeometry(referenceSample.points, sample.points);
  const recoveryViewRenders = cameraFit.views.map((selection, index) => {
    const posedIr = structuredClone(candidateIr);
    const residualDegrees = selectedCaptureViews[index]!.residualDegrees;
    if (residualDegrees !== 0) applyObservedCaptureYaw(posedIr, residualDegrees);
    const posedTriangles = collectThreeTriangles(compileAssemblyIR(posedIr, 'beauty').root);
    const score = scoreView(posedTriangles, index, selection.candidate.azimuthDegrees,
      selectedCameras[index]!, references);
    const reference = references[index]!;
    const candidateMask = cachedSilhouette(posedTriangles, selection.candidate.azimuthDegrees,
      reference.rawFrame.width, reference.rawFrame.height, selectedCameras[index]!).mask!;
    return { score, candidateMask };
  });
  const views = recoveryViewRenders.map((view) => view.score);
  const silhouette = auditMultiviewSilhouetteFidelity(views.map((view) => ({
    id: view.id, referenceDensity: view.referenceDensity, wholeIoU: view.wholeIoU,
    primaryMassIoU: view.primaryMassIoU, thinFeatureScore: view.thinFeature.score,
  })), { wholeIoU: 0.75, primaryMassIoU: 0.7, thinFeatureScore: 0.8 });
  const residual = auditSilhouetteResidualLocalization(recoveryViewRenders.map((view, index) => ({
    id: viewIds[index]!, width: references[index]!.rawFrame.width, height: references[index]!.rawFrame.height,
    referenceMask: references[index]!.rawFrame.mask!, candidateMask: view.candidateMask,
  })), { columns: 6, rows: 6, minimumComponentPixels: 4, localize: false });
  const maximumP95 = Math.max(audit.referenceP95Distance, audit.candidateP95Distance);
  const gateScores = {
    'geometry-rms': clampUnit(1 - audit.symmetricRmsChamfer / 0.2),
    'geometry-p95': clampUnit(1 - maximumP95 / 0.3),
    'geometry-coverage': audit.minimumCoverage,
    'dimension-fidelity': clampUnit(1 - audit.maximumDimensionRelativeError),
    'silhouette-whole': silhouette.minimumWholeIoU,
    'silhouette-primary': silhouette.minimumPrimaryMassIoU,
    'silhouette-thin': silhouette.minimumThinFeatureScore,
    'silhouette-recall': residual.minimumReferenceRecall,
    'silhouette-precision': residual.minimumCandidatePrecision,
  };
  const blockingGateIds = [
    audit.symmetricRmsChamfer > audit.thresholds.maximumRmsChamfer && 'geometry-rms',
    maximumP95 > audit.thresholds.maximumP95Distance && 'geometry-p95',
    audit.minimumCoverage < audit.thresholds.minimumCoverage && 'geometry-coverage',
    audit.maximumDimensionRelativeError > audit.thresholds.maximumDimensionRelativeError && 'dimension-fidelity',
    !silhouette.pass && 'silhouette-whole',
    residual.minimumReferenceRecall < 0.7 && 'silhouette-recall',
    residual.minimumCandidatePrecision < 0.7 && 'silhouette-precision',
  ].filter((id): id is keyof typeof gateScores => Boolean(id));
  return { gateScores, blockingGateIds };
};
const routedRecoveryActions = geometryRecoveryPlan.actions
    .filter((action) => action.operation !== 'request-region-evidence'
      && action.targetingMode === 'semantic-feature-overlap')
    .sort((left, right) => {
      const attribution = (action: typeof left): number => {
        const group = semanticSilhouetteAttribution.groups.find((candidate) => (
          candidate.groupId === action.semanticFeatureId
        ));
        if (!group) return Number.NEGATIVE_INFINITY;
        return action.operation === 'relocate-or-reshape-extraneous-units'
          ? group.weightedMeanDeltaIoU : -group.weightedMeanDeltaIoU;
      };
      return attribution(right) - attribution(left) || left.priority - right.priority;
    })
    .slice(0, 6);
const guardSpacingComponentIds = selectedIr.components
  .filter((component) => component.id.startsWith('cage-'))
  .map((component) => component.id);
const guardSpacingAction: GeometryRecoveryAction = {
  id: 'recover-side-profile-guard-spacing', causeBandId: 'candidate:z-middle',
  causeBandIds: ['candidate:z-middle'], priority: routedRecoveryActions.length + 1,
  operation: 'relocate-or-reshape-extraneous-units',
  targetComponentIds: guardSpacingComponentIds,
  candidateComponentCount: guardSpacingComponentIds.length,
  spatialConstraintIds: ['candidate:z-middle'], targetingMode: 'semantic-feature-overlap',
  semanticFeatureId: 'double-guard', evidenceViewIds: ['right', 'left'],
  requiredComponentIds: guardSpacingComponentIds,
  prohibitedOperations: ['delete-required-component', 'lower-locked-feature-count', 'change-source-evidence'],
  verificationGates: ['surface-geometry-fidelity', 'visual-plan-revision', 'topology-integrity', 'multiview-silhouette'],
  reason: 'The articulated side views expose repeated guard shells whose shared depth spacing must be tested around the head pivot.',
};
const recoverySearchPlan = {
  ...geometryRecoveryPlan,
  actions: [...routedRecoveryActions, guardSpacingAction],
};
recoverySearchPlan.actionable = recoverySearchPlan.actions.length > 0;
const axisRecoverySearchPlan = { ...recoverySearchPlan, actions: routedRecoveryActions };
const recoveryTrials = [
  ...createBoundedAxisScaleRecoveryTrials(axisRecoverySearchPlan, {
    alignedYawDegrees: geometryAudit.selectedYawDegrees,
    sourceIr: selectedIr,
    expansionFactors: [1.025, 1.05, 1.075, 1.1, 1.125],
    reductionFactors: [0.975, 0.95, 0.925, 0.9, 0.875],
    includeCounterfactualDirection: true,
    grouping: 'batch',
  }),
  ...createBoundedGroupAxisSpacingTrials(selectedIr, recoverySearchPlan, {
    axis: 2, factors: [0.4, 0.55, 0.7, 0.85], pivotMm: 0,
    actionIds: [guardSpacingAction.id],
  }),
];
const recoveryResult = recoveryTrials.length > 0
  ? await executeBoundedGeometryRecoverySearch(
    selectedIr, recoverySearchPlan, recoveryTrials, evaluateRecoveryCandidate,
    {
      targetGateIds: ['geometry-rms', 'geometry-p95', 'geometry-coverage'],
      minimumImprovement: 0.002,
      maximumProtectedRegression: 0.002,
      maximumTargetRegression: 0.0005,
    },
  )
  : {
    ir: selectedIr,
    report: {
      schema: 'morphloom.geometry-recovery-execution/0.1' as const,
      status: 'blocked' as const,
      inputFingerprint: '', outputFingerprint: '',
      baseline: await evaluateRecoveryCandidate(selectedIr), trials: [],
      blockers: ['localized recovery produced no safe edit trials'],
    },
  };
const deliveryIr = recoveryResult.ir;
const deliveryBuild = deliveryIr === selectedIr ? build : compileAssemblyIR(deliveryIr, 'beauty');
const referenceMaterialReceipt = applyReferenceMaterialEvidence(deliveryBuild.root, referenceMaterialSurface, { repeat: 4 });
const referenceFactorReceipt = bindReferenceMaterialFactorEvidence(deliveryBuild.root, {
  sourceId: referenceMaterialSurface.selectedSourceId,
  evidenceFingerprint: referenceMaterialSurface.selectedSourceFingerprint,
  channels: ['baseColor', 'metallic', 'roughness', 'normal'],
});
const deliverySurfaceTriangles = deliveryIr === selectedIr ? candidateSurfaceTriangles : collectThreeTriangles(deliveryBuild.root);
const deliverySample = sampleTriangleSurface(deliverySurfaceTriangles, 4_096);
const deliveryGeometryAudit = compareSurfaceGeometry(referenceSample.points, deliverySample.points);
deliveryBuild.root.updateMatrixWorld(true);
const deliveryComponentEvidence = new Map(deliveryIr.components.map((component) => [
  component.id, component.evidence?.status ?? 'inferred',
]));
const deliveryComponentObservations = deliveryBuild.root.children.flatMap((object) => {
  if (!(object instanceof THREE.Mesh) || !deliveryComponentEvidence.has(object.name)) return [];
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return [];
  return [observeAlignedComponentBounds(object.name, {
    minimum: bounds.min.toArray() as [number, number, number],
    maximum: bounds.max.toArray() as [number, number, number],
  }, deliveryComponentEvidence.get(object.name)!, deliveryGeometryAudit)];
});
const deliveryRecoveryPlan = createGeometryRecoveryPlan(
  deliveryGeometryAudit, visualPlan, deliveryComponentObservations, { maximumActions: 6 },
);
const deliveryCaptureViews = cameraFit.views.map((selection, index) => {
  const posedIr = structuredClone(deliveryIr);
  const residualDegrees = selectedCaptureViews[index]!.residualDegrees;
  if (residualDegrees !== 0) applyObservedCaptureYaw(posedIr, residualDegrees);
  const posedBuild = compileAssemblyIR(posedIr, 'beauty');
  const triangles = collectThreeTriangles(posedBuild.root);
  return {
    posedBuild, triangles,
    score: scoreView(triangles, index, selection.candidate.azimuthDegrees,
      selectedCameras[index]!, references),
  };
});
const deliveryViews = deliveryCaptureViews.map((view) => view.score);
const deliverySilhouetteAudit = auditMultiviewSilhouetteFidelity(deliveryViews.map((view) => ({
  id: view.id, referenceDensity: view.referenceDensity, wholeIoU: view.wholeIoU,
  primaryMassIoU: view.primaryMassIoU, thinFeatureScore: view.thinFeature.score,
})), { wholeIoU: 0.75, primaryMassIoU: 0.7, thinFeatureScore: 0.8 });
const deliveryCalibration = {
  views: deliveryViews,
  audit: deliverySilhouetteAudit,
  gateMargin: Math.min(...deliveryViews.map((view) => view.gateMargin)),
};
const deliverySilhouetteResidual = auditSilhouetteResidualLocalization(
  deliveryCaptureViews.map((view, index) => {
    const reference = references[index]!;
    const camera = selectedCameras[index]!;
    return {
      id: viewIds[index]!, width: reference.rawFrame.width, height: reference.rawFrame.height,
      referenceMask: reference.rawFrame.mask!,
      candidateMask: cachedSilhouette(view.triangles, cameraFit.views[index]!.candidate.azimuthDegrees,
        reference.rawFrame.width, reference.rawFrame.height, camera).mask!,
    };
  }),
  // Ignore sub-pixel/antialias speckle in the persisted diagnostic while
  // retaining narrow structural residuals at this benchmark's 512 px scale.
  { columns: 6, rows: 6, minimumComponentPixels: 64 },
);
const decompositionAudit = auditPartDecomposition(decomposition, deliveryIr);
const detailAudit = auditAssemblyDetail(deliveryIr);
const bytes = await exportCanonicalGlb(deliveryBuild.root);
const repeatBuild = compileAssemblyIR(structuredClone(deliveryIr), 'beauty');
applyReferenceMaterialEvidence(repeatBuild.root, referenceMaterialSurface, { repeat: 4 });
bindReferenceMaterialFactorEvidence(repeatBuild.root, {
  sourceId: referenceMaterialSurface.selectedSourceId,
  evidenceFingerprint: referenceMaterialSurface.selectedSourceFingerprint,
  channels: ['baseColor', 'metallic', 'roughness', 'normal'],
});
const repeatBytes = await exportCanonicalGlb(repeatBuild.root);
const artifactFingerprint = sha256(new Uint8Array(bytes));
const deterministic = artifactFingerprint === sha256(new Uint8Array(repeatBytes));
const validation = await validateGlbStandard(bytes);
writeFileSync(artifactPath, Buffer.from(bytes));
const candidateDocument = await nodeIo.readBinary(new Uint8Array(bytes));
const geometryOrientationDiagnostics = {
  verticalReflection: compareSurfaceGeometry(referenceSample.points,
    deliverySample.points.map(([x, y, z]) => [x, -y, z])),
  depthReflection: compareSurfaceGeometry(referenceSample.points,
    deliverySample.points.map(([x, y, z]) => [x, y, -z])),
};
const visualHullArtifactPath = resolve('tmp/abo-visual-hull/abo-industrial-floor-fan.glb');
const visualHullBaseline = existsSync(visualHullArtifactPath)
  ? (() => ({ path: visualHullArtifactPath }))()
  : undefined;
const visualHullGeometryAudit = visualHullBaseline
  ? compareSurfaceGeometry(referenceSample.points, sampleTriangleSurface(
    collectGltfTriangles(await nodeIo.read(visualHullBaseline.path)), 4_096,
  ).points)
  : undefined;
const [referencePbr, candidatePbr] = await Promise.all([
  collectPbrEvidence(groundTruthDocument, () => ({ provenance: 'reference', evidenceFingerprint: groundTruthFingerprint })),
  collectPbrEvidence(candidateDocument, (material) => referenceMaterialProvenanceFromExtras(material.getExtras())),
]);
const pbrAudit = auditPbrReferenceEvidence(referencePbr, candidatePbr, {
  acceptedEvidenceFingerprints: [groundTruthFingerprint, ...imageFingerprints],
});

for (let index = 0; index < references.length; index += 1) {
  const reference = references[index]!;
  const canvas = createCanvas(reference.frame.width, reference.frame.height);
  const context = canvas.getContext('2d');
  const image = context.createImageData(reference.frame.width, reference.frame.height);
  for (let pixel = 0; pixel < reference.frame.mask!.length; pixel += 1) {
    const value = reference.frame.mask![pixel] ? 0 : 255;
    image.data.set([value, value, value, 255], pixel * 4);
  }
  context.putImageData(image, 0, 0);
  writeFileSync(resolve(artifactRoot, `reference-${viewIds[index]}.png`), canvas.encodeSync('png'));
  const rawCanvas = createCanvas(reference.rawFrame.width, reference.rawFrame.height);
  const rawContext = rawCanvas.getContext('2d');
  const rawImage = rawContext.createImageData(reference.rawFrame.width, reference.rawFrame.height);
  for (let pixel = 0; pixel < reference.rawFrame.mask!.length; pixel += 1) {
    const value = reference.rawFrame.mask![pixel] ? 0 : 255;
    rawImage.data.set([value, value, value, 255], pixel * 4);
  }
  rawContext.putImageData(rawImage, 0, 0);
  writeFileSync(resolve(artifactRoot, `reference-raw-${viewIds[index]}.png`), rawCanvas.encodeSync('png'));
  const render = silhouetteFrameFromTriangles(deliveryCaptureViews[index]!.triangles, deliveryCalibration.views[index]!.renderAzimuthDegrees,
    reference.frame.width, reference.frame.height, deliveryCalibration.views[index]!.camera);
  writeFileSync(resolve(artifactRoot, `silhouette-${viewIds[index]}.png`), render.png);
  const massMask = solidifySilhouetteMask(render.mask!, render.width, render.height).mask;
  const massCanvas = createCanvas(render.width, render.height);
  const massContext = massCanvas.getContext('2d');
  const massImage = massContext.createImageData(render.width, render.height);
  for (let pixel = 0; pixel < massMask.length; pixel += 1) {
    const value = massMask[pixel] ? 0 : 255;
    massImage.data.set([value, value, value, 255], pixel * 4);
  }
  massContext.putImageData(massImage, 0, 0);
  writeFileSync(resolve(artifactRoot, `silhouette-mass-${viewIds[index]}.png`), massCanvas.encodeSync('png'));
  const groundTruthRender = silhouetteFrameFromTriangles(groundTruthTriangles, azimuths[index]!,
    reference.frame.width, reference.frame.height);
  writeFileSync(resolve(artifactRoot, `ground-truth-silhouette-${viewIds[index]}.png`), groundTruthRender.png);
}

const rigidMultiviewAudit = auditRigidMultiviewSet(references.map((reference, index) => ({
  id: viewIds[index]!, azimuthDegrees: azimuths[index]!, frame: reference.frame,
})));
const sampleSummary = (sample: typeof referenceSample) => ({
  points: sample.points.length, requestedSamples: sample.requestedSamples,
  sampledTriangles: sample.sampledTriangles, sourceTriangles: sample.sourceTriangles, surfaceArea: sample.surfaceArea,
});
const report = {
  schema: 'morphloom.abo-semantic-fan-pilot/0.2',
  pass: visualPlanAudit.pass && decompositionAudit.pass && deliveryCalibration.audit.pass
    && deliveryGeometryAudit.pass && pbrAudit.pass
    && validation.status === 'pass' && deterministic,
  productionReady: false,
  artifact: { path: artifactPath, bytes: bytes.byteLength, sha256: artifactFingerprint, deterministic, validation },
  structure: { components: components.length, visualPlanAudit, decompositionAudit },
  sourceViewSilhouette: {
    calibration: {
      strategy: 'ordered-cyclic-per-view-azimuth-fit',
      geometryIterationOnly,
      candidatesPerView: perViewScores[0]!.length,
      selection: 'maximize-worst-required-gate-margin-with-forward-cycle-and-bounded-steps',
      gateMargin: deliveryCalibration.gateMargin,
      stepDegrees: cameraFit.stepDegrees,
      selectedCameraModelId: cameraFit.selectedCameraModelId,
      cameraPoseEvidence: cameraFit.poseEvidenceAudit,
      sameCameraVisualClaimAllowed: cameraFit.sameCameraVisualClaimAllowed,
      cameras: deliveryViews.map((view) => ({
        id: view.id, azimuthDegrees: view.renderAzimuthDegrees, ...view.camera,
      })),
      fitBlockers: deliveryCalibration.gateMargin < 0
        ? [`Worst-view gate margin ${deliveryCalibration.gateMargin.toFixed(3)} is below zero.`]
        : [],
    },
    views: deliveryCalibration.views,
    audit: deliveryCalibration.audit,
    residualLocalization: deliverySilhouetteResidual,
    semanticAttribution: semanticSilhouetteAttribution,
    limitation: 'Foreground-normalized silhouettes and candidate-scored capture-pose residuals are development diagnostics only. The source contract proves nominal 90-degree turntable steps, but not object-frame absolute pose, camera intrinsics, crop homography, or zero residual pose.',
    observedArticulation: {
      headTiltDegrees: observedHeadTiltDegrees,
      candidates: articulationCandidates.map((candidate) => ({
        headTiltDegrees: candidate.headTiltDegrees,
        coarseGateMargin: candidate.coarseCalibration[0]!.gateMargin,
        coarseOffsetDegrees: candidate.coarseCalibration[0]!.offsetDegrees,
      })),
      evidenceStatus: 'inferred',
      deliveryClaimAllowed: false,
    },
    capturePoseResidual: {
      perViewCaptureYawResidualDegrees: Object.fromEntries(capturePoseResidualFit.views.map((view) => [
        view.id, view.selected.residualDegrees,
      ])),
      stateFit: capturePoseResidualFit,
      candidateScores: capturePoseCandidates.map((candidates, index) => ({
        viewId: viewIds[index]!,
        candidates: candidates.map((candidate) => ({
          stateId: candidate.stateId, residualDegrees: candidate.residualDegrees,
          gateMargin: candidate.score.gateMargin, wholeIoU: candidate.score.wholeIoU,
          primaryMassIoU: candidate.score.primaryMassIoU,
          thinFeatureScore: candidate.score.thinFeature.score,
        })),
      })),
      evidence: viewFiles,
      acceptanceRule: 'Select a bounded rigid whole-capture yaw residual only as a diagnostic, preserve the neutral asset, and keep delivery claims blocked when the residual is inferred rather than independently calibrated.',
    },
  },
  groundTruthGeometry: {
    reference: { source: 'Amazon Berkeley Objects CC-BY-4.0 ground-truth GLB', path: groundTruthPath, sample: sampleSummary(referenceSample) },
    candidate: { sample: sampleSummary(deliverySample) }, audit: deliveryGeometryAudit,
    orientationDiagnostics: geometryOrientationDiagnostics,
    visualHullBaseline: visualHullGeometryAudit
      ? { path: visualHullBaseline!.path, audit: visualHullGeometryAudit }
      : { status: 'not-available' },
    recoveryPlan: deliveryRecoveryPlan,
    recoverySearchPlan,
    recoveryExecution: recoveryResult.report,
    limitation: 'This development pilot was tuned against its GT and is excluded from independent holdout superiority claims.',
  },
  pbrReferenceAudit: {
    audit: pbrAudit, referenceMaterials: referencePbr.length, candidateMaterials: candidatePbr.length,
    referenceMaterialReceipt, referenceFactorReceipt,
    evidenceRule: 'Trusted spatial PBR variation must be delivered and SHA-256-bound to the GT or one of the four input views.',
  },
  rigidMultiviewAudit,
  deliveryAudit: { pass: detailAudit.pass, blockers: detailAudit.blockers },
  productionBlockers: [
    ...(cameraFit.poseEvidenceAudit?.claimBlockers ?? ['camera intrinsics and poses are not independently calibrated']),
    'hidden dimensions and internal motor interfaces remain inferred',
    ...(capturePoseResidualFit.deliveryClaimAllowed ? []
      : ['per-view whole-capture yaw residuals are inferred from silhouettes and expose an unresolved pose-evidence mismatch']),
    ...pbrAudit.blockers.map((blocker) => `PBR: ${blocker}`),
  ],
  dominanceBlockers: ['no same-input img2threejs candidate is available for an independent blind holdout comparison'],
};

writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  outputPath, pass: report.pass, productionReady: report.productionReady,
  artifact: { path: report.artifact.path, bytes: report.artifact.bytes, sha256: report.artifact.sha256,
    deterministic: report.artifact.deterministic, validation: report.artifact.validation.status },
  components: report.structure.components,
  silhouette: { calibration: report.sourceViewSilhouette.calibration, audit: report.sourceViewSilhouette.audit },
  geometry: report.groundTruthGeometry.audit,
  pbr: report.pbrReferenceAudit.audit,
  blockers: report.productionBlockers,
}, null, 2));
if (process.argv.includes('--require-pass') && !report.pass) process.exitCode = 1;
