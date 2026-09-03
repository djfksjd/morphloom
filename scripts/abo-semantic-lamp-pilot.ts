import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Canvas, ImageData, createCanvas, loadImage } from '@napi-rs/canvas';
import { Material, NodeIO, Texture } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import type { AssemblyComponentIR, AssemblyIR } from '../src/engine/assembly-ir';
import type { GroundTruthCorpusManifest } from '../src/engine/ground-truth-corpus';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { auditCameraPoseEvidence } from '../src/engine/camera-pose-evidence';
import { canonicalizeGlbBufferViews } from '../src/engine/glb-canonicalization';
import { auditAssemblyDetail } from '../src/engine/generation-policy';
import { preparePortableGltfGeometry, createPortableGltfExportInput } from '../src/engine/gltf-export-preparation';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';
import { auditPartDecomposition, type PartDecompositionContract } from '../src/engine/part-decomposition';
import { compareReferenceFrames, compareThinFeatureSilhouettes, type ComparisonFrame } from '../src/engine/reference-comparison';
import { normalizedFrame, sha256 } from './lib/visual-capture-frames';
import { extractThinTerminals } from '../src/engine/silhouette-skeleton';
import { auditRigidMultiviewSet } from '../src/engine/multiview-consistency';
import { inferOrthographicPlanExtents, measureForegroundBand } from '../src/engine/multiview-extents';
import { auditMultiviewSilhouetteFidelity } from '../src/engine/silhouette-fidelity';
import { reconstructUnorderedOrthographicLandmarks } from '../src/engine/multiview-landmark-reconstruction';
import {
  compareSurfaceGeometry,
  sampleTriangleSurface,
  type SurfaceTriangle3,
} from '../src/engine/surface-geometry-fidelity';
import {
  auditPbrReferenceEvidence,
  type PbrMaterialEvidence,
  type PbrSpatialChannel,
  type PbrTextureProvenance,
  type PbrTextureSignal,
} from '../src/engine/pbr-reference-audit';
import {
  applyReferenceMaterialEvidence,
  bindReferenceMaterialFactorEvidence,
  referenceMaterialProvenanceFromExtras,
} from '../src/engine/reference-material-evidence';
import { deriveMaskedReferenceSurface } from '../src/engine/reference-surface';

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

const assetRoot = resolve(process.argv[2] ?? 'work/abo/pilot/lamp');
const artifactRoot = resolve(process.argv[3] ?? 'tmp/abo-semantic-lamp');
const outputPath = resolve(process.argv[4] ?? 'benchmarks/abo-semantic-lamp-pilot-latest.json');
mkdirSync(artifactRoot, { recursive: true });

const corpusManifest = JSON.parse(readFileSync(resolve('benchmarks/corpora/abo-pilot.json'), 'utf8')) as GroundTruthCorpusManifest;
const corpusCase = corpusManifest.cases.find((item) => item.id === 'abo-industrial-tripod-lamp');
if (!corpusCase) throw new Error('ABO lamp camera evidence is missing from the locked corpus manifest.');

const allViews = ['front', 'right', 'rear', 'left'];
const viewFiles = ['view-000.jpg', 'view-090.jpg', 'view-180.jpg', 'view-270.jpg'];
const azimuths = [0, 90, 180, 270];
const references = await Promise.all(viewFiles.map((file) => normalizedFrame(resolve(assetRoot, file))));
const imageFingerprints = viewFiles.map((file) => sha256(new Uint8Array(readFileSync(resolve(assetRoot, file)))));
const referenceMaterialSurface = deriveMaskedReferenceSurface(references.map((reference, index) => ({
  id: allViews[index]!,
  fingerprint: imageFingerprints[index]!,
  width: reference.rawFrame.width,
  height: reference.rawFrame.height,
  rgba: reference.rawFrame.rgba,
  mask: reference.rawFrame.mask!,
})), { textureSize: 128, strength: 0.82, localizedPatch: true });
const cameraPoseEvidenceAudit = auditCameraPoseEvidence(
  corpusCase.cameraPoseEvidence,
  Object.fromEntries(allViews.map((id, index) => [id, imageFingerprints[index]!])),
);
if (!cameraPoseEvidenceAudit.pass || !cameraPoseEvidenceAudit.relativePoseVerified) {
  throw new Error(`ABO lamp camera evidence is invalid: ${cameraPoseEvidenceAudit.blockers.join('; ')}`);
}
const thinTerminalEvidence = references.map((reference, index) => ({
  id: allViews[index]!,
  ...extractThinTerminals(reference.frame.mask!, reference.frame.width, reference.frame.height, {
    regionTopFraction: 0.2, terminalStartFraction: 0.62, minimumTerminals: 2, maximumTerminals: 6,
  }),
}));
const headBands = references.map((reference, index) => {
  const bounds = measureForegroundBand(
    reference.frame.mask!, reference.frame.width, reference.frame.height, 0, 0.24,
  );
  if (!bounds) throw new Error(`ABO lamp ${allViews[index]} head band has no foreground.`);
  return bounds;
});
const headPlanExtentInference = inferOrthographicPlanExtents(headBands.map((bounds, index) => ({
  id: allViews[index]!, azimuthDegrees: azimuths[index]!, projectedWidth: bounds.width,
})));
const headDiameterMm = 224;
const headRadialEnvelopeMm = 234;
const headAxialDetailAllowanceMm = 56;
const headDepthMm = headPlanExtentInference.status === 'inferred'
  ? THREE.MathUtils.clamp(
    headPlanExtentInference.zExtent / headPlanExtentInference.xExtent * headRadialEnvelopeMm
      - headAxialDetailAllowanceMm,
    160, 320,
  )
  : 235;
const headFrontZ = -(headDepthMm / 2 + 8);
const headRearZ = headDepthMm / 2 + 17;

const blackMetal = { color: '#161616', surface: 'coated-metal' as const, roughness: 0.42, metalness: 0.78, microNormalStrength: 0.1 };
const lensMaterial = {
  color: '#f2dfad', emissive: '#ffd27d', surface: 'optical-glass' as const,
  roughness: 0.18, metalness: 0, transmission: 0.35, ior: 1.48,
};
const evidence = { status: 'estimated' as const, source: 'abo-pilot/lamp/four-spin-views', notes: ['LLM semantic decomposition; dimensions remain estimated pending calibrated landmarks.'] };
const component = (value: Omit<AssemblyComponentIR, 'category' | 'materialName' | 'detail' | 'evidence'> & Partial<Pick<AssemblyComponentIR, 'category' | 'materialName' | 'detail'>>): AssemblyComponentIR => ({
  category: 'mechanical', materialName: 'black coated steel', detail: 'independently editable evidence-mapped product part', evidence, ...value,
});

const components: AssemblyComponentIR[] = [
  component({ id: 'head-body', name: 'spotlight barrel', category: 'enclosure', geometry: { op: 'cylinder', radiusTop: headDiameterMm / 2, radiusBottom: headDiameterMm / 2, depth: headDepthMm, radialSegments: 64 }, position: [0, 610, 0], rotation: [Math.PI / 2, 0, 0], material: blackMetal }),
  component({ id: 'front-bezel', name: 'front retaining bezel', category: 'enclosure', geometry: { op: 'torus', radius: 103, tube: 14, radialSegments: 24, tubularSegments: 72 }, position: [0, 610, headFrontZ], material: blackMetal }),
  component({
    id: 'lens', name: 'diffuser lens', category: 'display', materialName: 'optical diffuser',
    geometry: { op: 'cylinder', radiusTop: 99, radiusBottom: 99, depth: 6, radialSegments: 64 },
    position: [0, 610, headFrontZ], rotation: [Math.PI / 2, 0, 0], material: lensMaterial,
    light: { color: '#ffd89a', intensity: 18, rangeMm: 2_200, decay: 2 },
  }),
  component({ id: 'rear-cap', name: 'rear service cap', category: 'enclosure', geometry: { op: 'cylinder', radiusTop: 82, radiusBottom: 96, depth: 34, radialSegments: 48 }, position: [0, 610, headRearZ], rotation: [Math.PI / 2, 0, 0], material: blackMetal }),
  component({ id: 'yoke', name: 'U-shaped tilt yoke', geometry: { op: 'tube', points: [[-118, 610, 0], [-118, 500, 0], [0, 472, 0], [118, 500, 0], [118, 610, 0]], radius: 7, tubularSegments: 48, radialSegments: 12 }, material: blackMetal }),
  component({ id: 'tilt-knob-left', name: 'left tilt knob', geometry: { op: 'cylinder', radiusTop: 15, radiusBottom: 15, depth: 12, radialSegments: 24 }, position: [-121, 610, 0], rotation: [0, 0, Math.PI / 2], material: blackMetal }),
  component({ id: 'tilt-knob-right', name: 'right tilt knob', geometry: { op: 'cylinder', radiusTop: 15, radiusBottom: 15, depth: 12, radialSegments: 24 }, position: [121, 610, 0], rotation: [0, 0, Math.PI / 2], material: blackMetal }),
  component({ id: 'neck-ball', name: 'tilt ball joint', geometry: { op: 'sphere', radius: 24, widthSegments: 32, heightSegments: 20 }, position: [0, 452, 0], material: blackMetal }),
  component({ id: 'neck-collar', name: 'decorative neck collar', geometry: { op: 'cylinder', radiusTop: 24, radiusBottom: 31, depth: 44, radialSegments: 32 }, position: [0, 410, 0], material: blackMetal }),
  component({ id: 'neck-stem', name: 'neck stem', geometry: { op: 'cylinder', radiusTop: 16, radiusBottom: 16, depth: 65, radialSegments: 24 }, position: [0, 360, 0], material: blackMetal }),
  component({ id: 'tripod-hub', name: 'tripod hub', geometry: { op: 'cylinder', radiusTop: 52, radiusBottom: 52, depth: 82, radialSegments: 32 }, position: [0, 305, 0], material: blackMetal }),
  component({ id: 'leg-left', name: 'left telescoping leg', geometry: { op: 'tube', points: [[-27, 280, 0], [-370, -700, 185]], radius: 10, tubularSegments: 64, radialSegments: 12 }, material: blackMetal }),
  component({ id: 'leg-right', name: 'right telescoping leg', geometry: { op: 'tube', points: [[27, 280, 0], [365, -560, -220]], radius: 10, tubularSegments: 64, radialSegments: 12 }, material: blackMetal }),
  component({ id: 'leg-rear', name: 'rear telescoping leg', geometry: { op: 'tube', points: [[0, 280, 22], [220, -735, 350]], radius: 10, tubularSegments: 64, radialSegments: 12 }, material: blackMetal }),
  component({ id: 'center-support', name: 'hanging auxiliary support', geometry: { op: 'tube', points: [[0, 280, 0], [-195, -520, -345]], radius: 5.5, tubularSegments: 48, radialSegments: 10 }, material: blackMetal }),
  component({ id: 'center-support-cap', name: 'auxiliary support end cap', materialName: 'rubber', geometry: { op: 'sphere', radius: 8, widthSegments: 16, heightSegments: 10 }, position: [-195, -520, -345], scale: [1, 0.6, 1], material: { color: '#111111', surface: 'rubber', roughness: 0.88, metalness: 0 } }),
  ...([[-370, -700, 185], [365, -560, -220], [220, -735, 350]] as Array<[number, number, number]>).map((position, index) => component({
    id: `foot-${index + 1}`, name: `rubber foot ${index + 1}`, materialName: 'rubber',
    geometry: { op: 'sphere', radius: 15, widthSegments: 20, heightSegments: 12 }, position,
    scale: [1, 0.55, 1], material: { color: '#111111', surface: 'rubber', roughness: 0.88, metalness: 0, microNormalStrength: 0.18 },
  })),
  ...([-85, -28, 30, 88] as number[]).map((x, index) => component({
    id: `bezel-screw-${index + 1}`, name: `bezel fastener ${index + 1}`,
    geometry: { op: 'sphere', radius: 4, widthSegments: 16, heightSegments: 10 },
    position: [x, 610 + (index % 2 === 0 ? 84 : -84), -142], material: { ...blackMetal, color: '#737373', metalness: 0.9 },
  })),
  component({ id: 'power-cable', name: 'power cable', category: 'interconnect', materialName: 'rubber cable', geometry: { op: 'tube', points: [[0, 465, 110], [42, 430, 80], [55, 355, 30], [42, 290, 10]], radius: 3.5, tubularSegments: 32, radialSegments: 10 }, material: { color: '#0c0c0c', surface: 'rubber', roughness: 0.82, metalness: 0 } }),
];

const decomposition: PartDecompositionContract = {
  schema: 'morphloom.part-decomposition/0.1', assetName: 'ABO industrial tripod lamp semantic reconstruction', sourceViewIds: allViews,
  features: [
    { id: 'head-stack', label: 'barrel, bezel, lens and rear cap', kind: 'optical-stack', required: true, evidenceRef: 'four-spin/head', evidenceStatus: 'estimated', sourceViewIds: allViews, componentIds: ['head-body', 'front-bezel', 'lens', 'rear-cap'], minimumCount: 4, geometryRequirement: 'layered-parts' },
    { id: 'tilt-yoke', label: 'U-shaped articulated yoke', kind: 'articulation', required: true, evidenceRef: 'four-spin/yoke', evidenceStatus: 'estimated', sourceViewIds: allViews, componentIds: ['head-body', 'yoke'], minimumCount: 2, geometryRequirement: 'articulated-parts' },
    { id: 'tilt-knobs', label: 'paired tilt knobs', kind: 'fastener', required: true, evidenceRef: 'four-spin/yoke-sides', evidenceStatus: 'estimated', sourceViewIds: ['front', 'rear'], componentIds: ['tilt-knob-left', 'tilt-knob-right'], minimumCount: 2, geometryRequirement: 'repeat-set' },
    { id: 'neck-stack', label: 'ball, collar, stem and hub', kind: 'layered-stack', required: true, evidenceRef: 'four-spin/neck', evidenceStatus: 'estimated', sourceViewIds: allViews, componentIds: ['neck-ball', 'neck-collar', 'neck-stem', 'tripod-hub'], minimumCount: 4, geometryRequirement: 'layered-parts' },
    { id: 'tripod-legs', label: 'three independent slender legs', kind: 'thin-feature', required: true, evidenceRef: 'four-spin/legs', evidenceStatus: 'estimated', sourceViewIds: allViews, componentIds: ['leg-left', 'leg-right', 'leg-rear'], minimumCount: 3, geometryRequirement: 'slender' },
    { id: 'center-support', label: 'hanging center support and terminal cap', kind: 'thin-feature', required: true, evidenceRef: 'four-spin/lower-terminals', evidenceStatus: 'estimated', sourceViewIds: allViews, componentIds: ['center-support', 'center-support-cap'], minimumCount: 1, geometryRequirement: 'slender', observedCounts: allViews.map((sourceViewId) => ({ sourceViewId, count: 1, method: 'silhouette-skeleton' as const })) },
    { id: 'visible-lower-terminals', label: 'four independently visible lower rods', kind: 'thin-feature', required: true, evidenceRef: 'four-spin/silhouette-skeleton', evidenceStatus: 'estimated', sourceViewIds: allViews, componentIds: ['leg-left', 'leg-right', 'leg-rear', 'center-support'], minimumCount: 4, geometryRequirement: 'slender', observedCounts: allViews.map((sourceViewId) => ({ sourceViewId, count: 4, method: 'silhouette-skeleton' as const })) },
    { id: 'rubber-feet', label: 'three terminal feet', kind: 'repeated-array', required: true, evidenceRef: 'four-spin/feet', evidenceStatus: 'estimated', sourceViewIds: allViews, componentIds: ['foot-1', 'foot-2', 'foot-3'], minimumCount: 3, geometryRequirement: 'repeat-set' },
    { id: 'bezel-fasteners', label: 'front bezel fasteners', kind: 'fastener', required: true, evidenceRef: 'front/bezel', evidenceStatus: 'estimated', sourceViewIds: ['front'], componentIds: ['bezel-screw-1', 'bezel-screw-2', 'bezel-screw-3', 'bezel-screw-4'], minimumCount: 4, geometryRequirement: 'repeat-set' },
    { id: 'cable-route', label: 'visible power cable route', kind: 'routed-element', required: true, evidenceRef: 'rear/cable', evidenceStatus: 'estimated', sourceViewIds: ['rear', 'left'], componentIds: ['power-cable'], minimumCount: 1, geometryRequirement: 'routed-curve' },
  ],
  relationships: [
    { id: 'head-hinges-yoke', fromFeatureId: 'head-stack', toFeatureId: 'tilt-yoke', kind: 'hinges-to', evidenceRef: 'four-spin/yoke', required: true },
    { id: 'yoke-mates-neck', fromFeatureId: 'tilt-yoke', toFeatureId: 'neck-stack', kind: 'mates-with', evidenceRef: 'four-spin/neck', required: true },
    { id: 'legs-attach-hub', fromFeatureId: 'tripod-legs', toFeatureId: 'neck-stack', kind: 'attached-to', evidenceRef: 'four-spin/hub', required: true },
    { id: 'feet-attach-legs', fromFeatureId: 'rubber-feet', toFeatureId: 'tripod-legs', kind: 'attached-to', evidenceRef: 'four-spin/feet', required: true },
    { id: 'cable-passes-neck', fromFeatureId: 'cable-route', toFeatureId: 'neck-stack', kind: 'passes-through', evidenceRef: 'rear/cable', required: true },
  ],
};

const ir: AssemblyIR = {
  schema: 'morphloom.assembly/0.1', name: decomposition.assetName, units: 'mm', components, partDecomposition: decomposition,
  metadata: {
    assetKind: 'product', qualityTarget: 'semi-professional-editable', evidenceDeliveryReady: false,
    evidenceUnresolvedCapabilities: 'independently calibrated image landmarks, calibrated PBR',
    fidelityContractRequired: true, partDecompositionRequired: true, benchmarkSource: 'amazon-berkeley-objects',
  },
};

function silhouetteFrame(root: THREE.Object3D, azimuthDegrees: number, width = 512, height = 256): ComparisonFrame & { png: Uint8Array } {
  root.updateMatrixWorld(true);
  const triangles: Array<Array<[number, number]>> = [];
  const projected: Array<[number, number]> = [];
  const angle = azimuthDegrees * Math.PI / 180;
  const project = (position: THREE.Vector3): [number, number] => [
    position.x * Math.cos(angle) - position.z * Math.sin(angle), position.y,
  ];
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BufferGeometry)) return;
    const position = object.geometry.getAttribute('position');
    const indices = object.geometry.index;
    const count = indices ? indices.count : position.count;
    const vector = new THREE.Vector3();
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const triangle: Array<[number, number]> = [];
      for (let corner = 0; corner < 3; corner += 1) {
        const index = indices ? indices.getX(offset + corner) : offset + corner;
        vector.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
        const point = project(vector);
        projected.push(point);
        triangle.push(point);
      }
      triangles.push(triangle);
    }
  });
  const minX = Math.min(...projected.map((point) => point[0]));
  const maxX = Math.max(...projected.map((point) => point[0]));
  const minY = Math.min(...projected.map((point) => point[1]));
  const maxY = Math.max(...projected.map((point) => point[1]));
  const padding = 12;
  const scale = Math.min((width - padding * 2) / (maxX - minX), (height - padding * 2) / (maxY - minY));
  const offsetX = (width - (maxX - minX) * scale) / 2;
  const offsetY = (height - (maxY - minY) * scale) / 2;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, width, height); context.fillStyle = '#000000';
  for (const triangle of triangles) {
    context.beginPath();
    triangle.forEach((point, index) => {
      const x = offsetX + (point[0] - minX) * scale;
      const y = height - (offsetY + (point[1] - minY) * scale);
      if (index === 0) context.moveTo(x, y); else context.lineTo(x, y);
    });
    context.closePath(); context.fill();
  }
  const rgba = context.getImageData(0, 0, width, height).data;
  const mask = new Uint8Array(width * height);
  for (let pixel = 0; pixel < mask.length; pixel += 1) mask[pixel] = Number(rgba[pixel * 4]! < 128);
  return { width, height, rgba, mask, png: new Uint8Array(canvas.encodeSync('png')) };
}

function projectedBounds(root: THREE.Object3D, azimuthDegrees: number) {
  root.updateMatrixWorld(true);
  const angle = azimuthDegrees * Math.PI / 180;
  let minimumU = Number.POSITIVE_INFINITY;
  let maximumU = Number.NEGATIVE_INFINITY;
  let minimumY = Number.POSITIVE_INFINITY;
  let maximumY = Number.NEGATIVE_INFINITY;
  const point = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BufferGeometry)) return;
    const position = object.geometry.getAttribute('position');
    for (let index = 0; index < position.count; index += 1) {
      point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
      const u = point.x * Math.cos(angle) - point.z * Math.sin(angle);
      minimumU = Math.min(minimumU, u); maximumU = Math.max(maximumU, u);
      minimumY = Math.min(minimumY, point.y); maximumY = Math.max(maximumY, point.y);
    }
  });
  if (![minimumU, maximumU, minimumY, maximumY].every(Number.isFinite)
    || maximumU <= minimumU || maximumY <= minimumY) {
    throw new Error('Semantic lamp projected bounds are empty or degenerate.');
  }
  return { minimumU, maximumU, minimumY, maximumY };
}

const upperHeight = Math.round(references[0]!.frame.height * 0.25);
const primaryMassCalibrationWeight = 0.35;
const thinFeatureCalibrationWeight = 1 - primaryMassCalibrationWeight;

function scoreCalibrationAtOffset(root: THREE.Object3D, offsetDegrees: number) {
  const scores = references.map((reference, index) => {
    const render = silhouetteFrame(root, (azimuths[index]! + offsetDegrees) % 360);
    const comparison = compareReferenceFrames(reference.frame, render, [{
      featureId: 'primary-mass', x: 0, y: 0, width: reference.frame.width, height: upperHeight,
    }]);
    const thin = compareThinFeatureSilhouettes(reference.frame, render, 3);
    const primaryMassIoU = comparison.regions[0]!.silhouetteIoU;
    return {
      wholeIoU: comparison.silhouetteIoU,
      primaryMassIoU,
      thinScore: thin.score,
      hybrid: primaryMassIoU * primaryMassCalibrationWeight + thin.score * thinFeatureCalibrationWeight,
    };
  });
  const minimumPrimaryMassIoU = Math.min(...scores.map((score) => score.primaryMassIoU));
  const minimumThinFeatureScore = Math.min(...scores.map((score) => score.thinScore));
  return {
    offsetDegrees: normalizeAzimuth(offsetDegrees),
    gateMargin: Math.min(minimumPrimaryMassIoU / 0.7, minimumThinFeatureScore / 0.8),
    minimumPrimaryMassIoU,
    minimumThinFeatureScore,
    minimumHybrid: Math.min(...scores.map((score) => score.hybrid)),
    meanHybrid: scores.reduce((sum, score) => sum + score.hybrid, 0) / scores.length,
    minimumIoU: Math.min(...scores.map((score) => score.wholeIoU)),
  };
}

function normalizeAzimuth(value: number): number {
  return ((value % 360) + 360) % 360;
}

function selectCalibration(root: THREE.Object3D) {
  const candidates = [];
  for (let offsetDegrees = 0; offsetDegrees < 360; offsetDegrees += 4) {
    candidates.push(scoreCalibrationAtOffset(root, offsetDegrees));
  }
  candidates.sort((left, right) => right.gateMargin - left.gateMargin
    || right.minimumHybrid - left.minimumHybrid || right.meanHybrid - left.meanHybrid
    || left.offsetDegrees - right.offsetDegrees);
  return { selected: candidates[0]!, candidates };
}

function collectThreeTriangles(root: THREE.Object3D): SurfaceTriangle3[] {
  root.updateMatrixWorld(true);
  const triangles: SurfaceTriangle3[] = [];
  const point = new THREE.Vector3();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.geometry instanceof THREE.BufferGeometry)) return;
    const position = object.geometry.getAttribute('position');
    const indices = object.geometry.index;
    const count = indices ? indices.count : position.count;
    for (let offset = 0; offset + 2 < count; offset += 3) {
      const vertices = [0, 1, 2].map((corner) => {
        const index = indices ? indices.getX(offset + corner) : offset + corner;
        point.fromBufferAttribute(position, index).applyMatrix4(object.matrixWorld);
        return point.toArray() as [number, number, number];
      });
      triangles.push({ a: vertices[0]!, b: vertices[1]!, c: vertices[2]! });
    }
  });
  return triangles;
}

function collectGltfTriangles(document: import('@gltf-transform/core').Document): SurfaceTriangle3[] {
  const triangles: SurfaceTriangle3[] = [];
  for (const scene of document.getRoot().listScenes()) scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const matrix = node.getWorldMatrix();
    const transform = (array: ArrayLike<number>, index: number): [number, number, number] => {
      const x = array[index * 3]!; const y = array[index * 3 + 1]!; const z = array[index * 3 + 2]!;
      return [
        matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
        matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
        matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
      ];
    };
    for (const primitive of mesh.listPrimitives()) {
      const position = primitive.getAttribute('POSITION');
      if (!position) continue;
      const positions = position.getArray();
      const indices = primitive.getIndices()?.getArray();
      const count = indices?.length ?? position.getCount();
      for (let offset = 0; offset + 2 < count; offset += 3) {
        const index = (corner: number) => Number(indices?.[offset + corner] ?? offset + corner);
        triangles.push({
          a: transform(positions, index(0)),
          b: transform(positions, index(1)),
          c: transform(positions, index(2)),
        });
      }
    }
  });
  return triangles;
}

function triangleArea(triangle: SurfaceTriangle3): number {
  const ab = new THREE.Vector3().fromArray(triangle.b).sub(new THREE.Vector3().fromArray(triangle.a));
  const ac = new THREE.Vector3().fromArray(triangle.c).sub(new THREE.Vector3().fromArray(triangle.a));
  return ab.cross(ac).length() * 0.5;
}

function materialSurfaceAreas(document: import('@gltf-transform/core').Document): Map<Material, number> {
  const areas = new Map<Material, number>();
  for (const scene of document.getRoot().listScenes()) scene.traverse((node) => {
    const mesh = node.getMesh();
    if (!mesh) return;
    const matrix = node.getWorldMatrix();
    const transform = (array: ArrayLike<number>, index: number): [number, number, number] => {
      const x = array[index * 3]!; const y = array[index * 3 + 1]!; const z = array[index * 3 + 2]!;
      return [
        matrix[0]! * x + matrix[4]! * y + matrix[8]! * z + matrix[12]!,
        matrix[1]! * x + matrix[5]! * y + matrix[9]! * z + matrix[13]!,
        matrix[2]! * x + matrix[6]! * y + matrix[10]! * z + matrix[14]!,
      ];
    };
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial();
      const position = primitive.getAttribute('POSITION');
      if (!material || !position) continue;
      const positions = position.getArray();
      const indices = primitive.getIndices()?.getArray();
      const count = indices?.length ?? position.getCount();
      let area = 0;
      for (let offset = 0; offset + 2 < count; offset += 3) {
        const index = (corner: number) => Number(indices?.[offset + corner] ?? offset + corner);
        area += triangleArea({
          a: transform(positions, index(0)),
          b: transform(positions, index(1)),
          c: transform(positions, index(2)),
        });
      }
      if (Number.isFinite(area) && area > 0) areas.set(material, (areas.get(material) ?? 0) + area);
    }
  });
  return areas;
}

async function textureSignal(
  texture: Texture | null,
  provenance: PbrTextureProvenance,
  cache: Map<Texture, Promise<PbrTextureSignal>>,
): Promise<PbrTextureSignal | undefined> {
  if (!texture) return undefined;
  const cached = cache.get(texture);
  if (cached) return cached;
  const pending = (async () => {
    const bytes = texture.getImage();
    if (!bytes || bytes.byteLength < 1 || bytes.byteLength > 32 * 1024 * 1024) {
      throw new Error(`PBR texture ${texture.getName() || '<unnamed>'} is outside the 32 MB encoded budget.`);
    }
    const declaredSize = texture.getSize();
    if (!declaredSize || declaredSize[0] < 1 || declaredSize[1] < 1
      || declaredSize[0] > 8_192 || declaredSize[1] > 8_192
      || declaredSize[0] * declaredSize[1] > 16_777_216) {
      throw new Error(`PBR texture ${texture.getName() || '<unnamed>'} dimensions are unsafe.`);
    }
    const image = await loadImage(bytes);
    if (image.width !== declaredSize[0] || image.height !== declaredSize[1]) {
      throw new Error(`PBR texture ${texture.getName() || '<unnamed>'} decoded dimensions do not match its header.`);
    }
    const sampleWidth = Math.min(image.width, 512);
    const sampleHeight = Math.min(image.height, 512);
    const canvas = createCanvas(sampleWidth, sampleHeight);
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
    const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
    const minimum = [255, 255, 255, 255];
    const maximum = [0, 0, 0, 0];
    const sum = [0, 0, 0, 0];
    const squared = [0, 0, 0, 0];
    for (let offset = 0; offset < pixels.length; offset += 4) {
      for (let channel = 0; channel < 4; channel += 1) {
        const value = pixels[offset + channel]!;
        minimum[channel] = Math.min(minimum[channel]!, value);
        maximum[channel] = Math.max(maximum[channel]!, value);
        sum[channel] += value;
        squared[channel] += value * value;
      }
    }
    const count = pixels.length / 4;
    const mean = sum.map((value) => value / count / 255) as PbrTextureSignal['mean'];
    const standardDeviation = squared.map((value, channel) => Math.sqrt(Math.max(0,
      value / count - (sum[channel]! / count) ** 2,
    )) / 255) as PbrTextureSignal['standardDeviation'];
    const range = maximum.map((value, channel) => (value - minimum[channel]!) / 255) as PbrTextureSignal['range'];
    return {
      width: image.width,
      height: image.height,
      payloadFingerprint: sha256(bytes),
      encodedBytes: bytes.byteLength,
      mean,
      standardDeviation,
      range,
      provenance,
    };
  })();
  cache.set(texture, pending);
  return pending;
}

async function collectPbrEvidence(
  document: import('@gltf-transform/core').Document,
  provenanceFor: (material: Material) => {
    provenance: PbrTextureProvenance;
    evidenceFingerprint?: string;
    factorProvenanceByChannel?: Partial<Record<PbrSpatialChannel, PbrTextureProvenance>>;
    evidenceFingerprintByChannel?: Partial<Record<PbrSpatialChannel, string>>;
    textureProvenanceByChannel?: Partial<Record<PbrSpatialChannel, PbrTextureProvenance>>;
  },
): Promise<PbrMaterialEvidence[]> {
  const areas = materialSurfaceAreas(document);
  const cache = new Map<Texture, Promise<PbrTextureSignal>>();
  return Promise.all([...areas].map(async ([material, weight], materialIndex) => {
    const provenanceReceipt = provenanceFor(material);
    const [baseColorTexture, metallicRoughnessTexture, normalTexture, emissiveTexture] = await Promise.all([
      textureSignal(material.getBaseColorTexture(), provenanceReceipt.textureProvenanceByChannel?.baseColor
        ?? provenanceReceipt.provenance, cache),
      textureSignal(material.getMetallicRoughnessTexture(), provenanceReceipt.textureProvenanceByChannel?.roughness
        ?? provenanceReceipt.provenance, cache),
      textureSignal(material.getNormalTexture(), provenanceReceipt.textureProvenanceByChannel?.normal
        ?? provenanceReceipt.provenance, cache),
      textureSignal(material.getEmissiveTexture(), provenanceReceipt.textureProvenanceByChannel?.emissive
        ?? provenanceReceipt.provenance, cache),
    ]);
    return {
      id: material.getName() || `material-${materialIndex + 1}`,
      weight,
      baseColorFactor: material.getBaseColorFactor(),
      metallicFactor: material.getMetallicFactor(),
      roughnessFactor: material.getRoughnessFactor(),
      normalScale: material.getNormalScale(),
      emissiveFactor: material.getEmissiveFactor(),
      factorProvenance: provenanceReceipt.provenance,
      evidenceFingerprint: provenanceReceipt.evidenceFingerprint,
      factorProvenanceByChannel: provenanceReceipt.factorProvenanceByChannel,
      evidenceFingerprintByChannel: provenanceReceipt.evidenceFingerprintByChannel,
      textureProvenanceByChannel: provenanceReceipt.textureProvenanceByChannel,
      baseColorTexture, metallicRoughnessTexture, normalTexture, emissiveTexture,
    };
  }));
}

async function exportGlb(root: THREE.Object3D): Promise<ArrayBuffer> {
  const preparation = preparePortableGltfGeometry(root);
  if (preparation.unresolvedNormalMappedMeshes.length > 0) throw new Error('semantic lamp has unresolved tangent inputs');
  const result = await new GLTFExporter().parseAsync(createPortableGltfExportInput(root), { binary: true, onlyVisible: true, includeCustomExtensions: true });
  if (!(result instanceof ArrayBuffer)) throw new Error('semantic lamp did not export a binary GLB');
  return canonicalizeGlbBufferViews(result);
}

const initialLandmarks = [
  { id: 'leg-left', position: [-0.370, -0.700, 0.185] as [number, number, number] },
  { id: 'leg-right', position: [0.365, -0.560, -0.220] as [number, number, number] },
  { id: 'leg-rear', position: [0.220, -0.735, 0.350] as [number, number, number] },
  { id: 'center-support', position: [-0.195, -0.520, -0.345] as [number, number, number] },
];
const baselineBuild = compileAssemblyIR(ir, 'beauty');
const baselineCalibration = selectCalibration(baselineBuild.root);
const terminalInputsAvailable = thinTerminalEvidence.every((entry) => entry.status === 'extracted'
  && entry.terminals.length === initialLandmarks.length);
const landmarkReconstruction = terminalInputsAvailable
  ? reconstructUnorderedOrthographicLandmarks(initialLandmarks, thinTerminalEvidence.map((entry, index) => {
    const renderAzimuthDegrees = (azimuths[index]! + baselineCalibration.selected.offsetDegrees) % 360;
    return {
      id: entry.id,
      azimuthDegrees: renderAzimuthDegrees,
      projectedBounds: projectedBounds(baselineBuild.root, renderAzimuthDegrees),
      observations: entry.terminals.map((terminal) => ({
        u: terminal.normalizedX,
        v: terminal.normalizedY,
        confidence: 0.9,
      })),
    };
  }), { maximumRmsNormalizedError: 0.12, maximumNormalizedError: 0.22, preserveInputY: true })
  : {
    status: 'blocked' as const,
    landmarks: initialLandmarks,
    assignments: [],
    iterations: 0,
    rmsNormalizedError: Number.POSITIVE_INFINITY,
    maximumNormalizedError: Number.POSITIVE_INFINITY,
    blockers: ['Every source view must expose exactly four lower terminals.'],
  };

let selectedIr = ir;
let build = baselineBuild;
let calibrationSelection = baselineCalibration;
let landmarkFeedbackApplied = false;
let landmarkFeedbackCandidate = null as null | typeof baselineCalibration.selected;
if (landmarkReconstruction.status === 'reconstructed') {
  const candidateIr = structuredClone(ir);
  const terminalTargets = new Map(landmarkReconstruction.landmarks.map((landmark) => [landmark.id, landmark.position]));
  const terminalAttachments = new Map([
    ['leg-left', 'foot-1'], ['leg-right', 'foot-2'], ['leg-rear', 'foot-3'], ['center-support', 'center-support-cap'],
  ]);
  for (const [componentId, attachmentId] of terminalAttachments) {
    const position = terminalTargets.get(componentId);
    const member = candidateIr.components.find((entry) => entry.id === componentId);
    const attachment = candidateIr.components.find((entry) => entry.id === attachmentId);
    if (!position || !member || member.geometry.op !== 'tube' || !attachment) {
      throw new Error(`Semantic lamp feedback target ${componentId}/${attachmentId} is incomplete.`);
    }
    const positionMm = position.map((value) => value * 1_000) as [number, number, number];
    member.geometry.points[member.geometry.points.length - 1] = positionMm;
    attachment.position = [...positionMm];
  }
  const candidateBuild = compileAssemblyIR(candidateIr, 'beauty');
  const candidateCalibration = selectCalibration(candidateBuild.root);
  landmarkFeedbackCandidate = candidateCalibration.selected;
  const baselineScore = baselineCalibration.selected;
  const candidateScore = candidateCalibration.selected;
  const noRequiredMetricRegressed = candidateScore.minimumPrimaryMassIoU >= baselineScore.minimumPrimaryMassIoU - 1e-6
    && candidateScore.minimumThinFeatureScore >= baselineScore.minimumThinFeatureScore - 1e-6;
  const requiredMetricImproved = candidateScore.minimumPrimaryMassIoU > baselineScore.minimumPrimaryMassIoU + 1e-6
    || candidateScore.minimumThinFeatureScore > baselineScore.minimumThinFeatureScore + 1e-6;
  const boundedHybridTradeoff = candidateScore.minimumHybrid >= baselineScore.minimumHybrid + 0.01
    && candidateScore.minimumPrimaryMassIoU >= baselineScore.minimumPrimaryMassIoU - 0.005
    && candidateScore.minimumThinFeatureScore >= baselineScore.minimumThinFeatureScore - 0.005;
  if (candidateScore.gateMargin > baselineScore.gateMargin + 1e-6
    || (noRequiredMetricRegressed && requiredMetricImproved) || boundedHybridTradeoff) {
    selectedIr = candidateIr;
    build = candidateBuild;
    calibrationSelection = candidateCalibration;
    landmarkFeedbackApplied = true;
  }
}

function applyHeadRadialScale(candidateIr: AssemblyIR, factor: number): void {
  for (const id of ['head-body', 'lens', 'rear-cap']) {
    const entry = candidateIr.components.find((componentEntry) => componentEntry.id === id);
    if (!entry || entry.geometry.op !== 'cylinder') throw new Error(`Head cylinder ${id} is missing from the semantic lamp IR.`);
    entry.geometry.radiusTop *= factor;
    entry.geometry.radiusBottom *= factor;
  }
  const bezel = candidateIr.components.find((entry) => entry.id === 'front-bezel');
  if (!bezel || bezel.geometry.op !== 'torus') throw new Error('Head bezel is missing from the semantic lamp IR.');
  bezel.geometry.radius *= factor;
  bezel.geometry.tube *= factor;
  for (const entry of candidateIr.components.filter((componentEntry) => componentEntry.id.startsWith('bezel-screw-'))) {
    if (!entry.position) throw new Error(`Head fastener ${entry.id} has no position.`);
    entry.position[0] *= factor;
    entry.position[1] = 610 + (entry.position[1] - 610) * factor;
  }
}

const headFeedbackCandidates = [] as Array<{
  radialScale: number;
  score: ReturnType<typeof scoreCalibrationAtOffset>;
  ir: AssemblyIR;
  build: ReturnType<typeof compileAssemblyIR>;
}>;
const localCalibrationOffsets = [-12, -8, -4, 0, 4, 8, 12]
  .map((delta) => normalizeAzimuth(calibrationSelection.selected.offsetDegrees + delta));
for (const radialScale of [0.82, 0.88, 0.94, 1, 1.06]) {
  const candidateIr = structuredClone(selectedIr);
  if (radialScale !== 1) applyHeadRadialScale(candidateIr, radialScale);
  const candidateBuild = radialScale === 1 ? build : compileAssemblyIR(candidateIr, 'beauty');
  const localScores = localCalibrationOffsets.map((offset) => scoreCalibrationAtOffset(candidateBuild.root, offset));
  localScores.sort((left, right) => right.gateMargin - left.gateMargin
    || right.minimumPrimaryMassIoU - left.minimumPrimaryMassIoU
    || right.minimumThinFeatureScore - left.minimumThinFeatureScore
    || right.minimumHybrid - left.minimumHybrid);
  headFeedbackCandidates.push({ radialScale, score: localScores[0]!, ir: candidateIr, build: candidateBuild });
}
headFeedbackCandidates.sort((left, right) => right.score.gateMargin - left.score.gateMargin
  || right.score.minimumPrimaryMassIoU - left.score.minimumPrimaryMassIoU
  || right.score.minimumThinFeatureScore - left.score.minimumThinFeatureScore
  || right.score.minimumHybrid - left.score.minimumHybrid);
const selectedHeadFeedback = headFeedbackCandidates[0]!;
const headFeedbackApplied = selectedHeadFeedback.radialScale !== 1
  && selectedHeadFeedback.score.gateMargin > calibrationSelection.selected.gateMargin + 1e-6;
if (headFeedbackApplied) {
  selectedIr = selectedHeadFeedback.ir;
  build = selectedHeadFeedback.build;
  calibrationSelection = selectCalibration(build.root);
}

const calibrationCandidates = calibrationSelection.candidates;
const calibration = calibrationSelection.selected;
const decompositionAudit = auditPartDecomposition(decomposition, selectedIr);
const detailAudit = auditAssemblyDetail(selectedIr);
const referenceMaterialReceipt = applyReferenceMaterialEvidence(build.root, referenceMaterialSurface, {
  repeat: 4,
  materialFilter: (_material, mesh) => mesh.name !== 'lens',
});
const referenceFactorReceipt = bindReferenceMaterialFactorEvidence(build.root, {
  sourceId: referenceMaterialSurface.selectedSourceId,
  evidenceFingerprint: referenceMaterialSurface.selectedSourceFingerprint,
  channels: ['baseColor', 'metallic', 'roughness', 'normal', 'emissive'],
});
const bytes = await exportGlb(build.root);
const repeatBuild = compileAssemblyIR(structuredClone(selectedIr), 'beauty');
applyReferenceMaterialEvidence(repeatBuild.root, referenceMaterialSurface, {
  repeat: 4,
  materialFilter: (_material, mesh) => mesh.name !== 'lens',
});
bindReferenceMaterialFactorEvidence(repeatBuild.root, {
  sourceId: referenceMaterialSurface.selectedSourceId,
  evidenceFingerprint: referenceMaterialSurface.selectedSourceFingerprint,
  channels: ['baseColor', 'metallic', 'roughness', 'normal', 'emissive'],
});
const repeat = await exportGlb(repeatBuild.root);
const validation = await validateGlbStandard(bytes);
const artifactPath = resolve(artifactRoot, 'abo-industrial-tripod-lamp-semantic.glb');
writeFileSync(artifactPath, Buffer.from(bytes));
const groundTruthPath = resolve(assetRoot, 'ground-truth.glb');
const groundTruthFingerprint = sha256(new Uint8Array(readFileSync(groundTruthPath)));
const lockedImageFingerprints = imageFingerprints;
const nodeIo = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const groundTruthDocument = await nodeIo.read(groundTruthPath);
const candidateDocument = await nodeIo.readBinary(new Uint8Array(bytes));
const groundTruthSurfaceSample = sampleTriangleSurface(collectGltfTriangles(groundTruthDocument), 512);
const generatedSurfaceSample = sampleTriangleSurface(collectThreeTriangles(build.root), 512);
const groundTruthGeometry = compareSurfaceGeometry(groundTruthSurfaceSample.points, generatedSurfaceSample.points);
const [groundTruthPbrEvidence, candidatePbrEvidence] = await Promise.all([
  collectPbrEvidence(groundTruthDocument, () => ({ provenance: 'reference', evidenceFingerprint: groundTruthFingerprint })),
  collectPbrEvidence(candidateDocument, (material) => referenceMaterialProvenanceFromExtras(material.getExtras())),
]);
const pbrReferenceAudit = auditPbrReferenceEvidence(groundTruthPbrEvidence, candidatePbrEvidence, {
  acceptedEvidenceFingerprints: [groundTruthFingerprint, ...lockedImageFingerprints],
});
const sampleSummary = (sample: typeof groundTruthSurfaceSample) => ({
  points: sample.points.length,
  requestedSamples: sample.requestedSamples,
  sampledTriangles: sample.sampledTriangles,
  sourceTriangles: sample.sourceTriangles,
  surfaceArea: sample.surfaceArea,
});
for (let index = 0; index < viewFiles.length; index += 1) {
  const reference = references[index]!;
  const referenceCanvas = createCanvas(reference.frame.width, reference.frame.height);
  const referenceContext = referenceCanvas.getContext('2d');
  const referenceMaskImage = referenceContext.createImageData(reference.frame.width, reference.frame.height);
  for (let pixel = 0; pixel < reference.frame.mask!.length; pixel += 1) {
    const value = reference.frame.mask![pixel] ? 0 : 255;
    const offset = pixel * 4;
    referenceMaskImage.data[offset] = value;
    referenceMaskImage.data[offset + 1] = value;
    referenceMaskImage.data[offset + 2] = value;
    referenceMaskImage.data[offset + 3] = 255;
  }
  referenceContext.putImageData(referenceMaskImage, 0, 0);
  writeFileSync(resolve(artifactRoot, `reference-${allViews[index]}.png`), referenceCanvas.encodeSync('png'));
}
const views = [];
for (let index = 0; index < viewFiles.length; index += 1) {
  const renderAzimuth = (azimuths[index]! + calibration.offsetDegrees) % 360;
  const render = silhouetteFrame(build.root, renderAzimuth);
  writeFileSync(resolve(artifactRoot, `silhouette-${allViews[index]}.png`), render.png);
  const comparison = compareReferenceFrames(references[index]!.frame, render, [{
    featureId: 'primary-mass', x: 0, y: 0, width: references[index]!.frame.width, height: upperHeight,
  }]);
  const thinFeature = compareThinFeatureSilhouettes(references[index]!.frame, render, 3);
  const primaryMassIoU = comparison.regions[0]!.silhouetteIoU;
  const referenceDensity = references[index]!.frame.mask!.reduce((sum, value) => sum + value, 0)
    / references[index]!.frame.mask!.length;
  views.push({
    id: allViews[index], source: viewFiles[index], evidenceAzimuthDegrees: azimuths[index],
    renderAzimuthDegrees: renderAzimuth, referenceDensity, silhouetteIoU: comparison.silhouetteIoU,
    primaryMassIoU, thinFeature,
    hybridScore: primaryMassIoU * primaryMassCalibrationWeight + thinFeature.score * thinFeatureCalibrationWeight,
  });
}
const silhouettePass = views.every((view) => view.silhouetteIoU >= 0.75);
const silhouetteAudit = auditMultiviewSilhouetteFidelity(views.map((view) => ({
  id: view.id!, referenceDensity: view.referenceDensity, wholeIoU: view.silhouetteIoU,
  primaryMassIoU: view.primaryMassIoU, thinFeatureScore: view.thinFeature.score,
})));
const rigidMultiviewAudit = auditRigidMultiviewSet(references.map((reference, index) => ({
  id: allViews[index]!, azimuthDegrees: azimuths[index]!, frame: reference.frame,
})));
const report = {
  schema: 'morphloom.abo-semantic-lamp-pilot/0.2',
  pass: decompositionAudit.pass && silhouetteAudit.pass && groundTruthGeometry.pass && pbrReferenceAudit.pass
    && validation.status === 'pass' && sha256(new Uint8Array(bytes)) === sha256(new Uint8Array(repeat)),
  productionReady: false,
  artifact: { path: artifactPath, bytes: bytes.byteLength, sha256: sha256(new Uint8Array(bytes)), deterministic: sha256(new Uint8Array(bytes)) === sha256(new Uint8Array(repeat)), validation },
  structure: { components: components.length, decompositionAudit },
  thinTerminalEvidence,
  landmarkFeedback: {
    reconstruction: landmarkReconstruction,
    coordinateUnit: 'compiled-scene-meters',
    applied: landmarkFeedbackApplied,
    acceptanceRule: 'apply on a better worst gate margin, a strict Pareto improvement, or a >=0.01 sparse-hybrid gain with every required regression bounded to 0.005',
    baselineGateMargin: baselineCalibration.selected.gateMargin,
    candidate: landmarkFeedbackCandidate,
    selectedGateMargin: calibration.gateMargin,
  },
  headFeedback: {
    applied: headFeedbackApplied,
    selectedRadialScale: selectedHeadFeedback.radialScale,
    selectedLocalScore: selectedHeadFeedback.score,
    candidates: headFeedbackCandidates.map((candidate) => ({ radialScale: candidate.radialScale, score: candidate.score })),
    acceptanceRule: 'bounded radial candidates; apply only when the worst required gate margin improves',
  },
  groundTruthGeometry: {
    reference: {
      source: 'Amazon Berkeley Objects CC-BY-4.0 ground-truth GLB',
      path: groundTruthPath,
      sample: sampleSummary(groundTruthSurfaceSample),
    },
    candidate: { sample: sampleSummary(generatedSurfaceSample) },
    audit: groundTruthGeometry,
  },
  pbrReferenceAudit: {
    audit: pbrReferenceAudit,
    referenceMaterials: groundTruthPbrEvidence.length,
    candidateMaterials: candidatePbrEvidence.length,
    referenceMaterialReceipt,
    referenceFactorReceipt,
    evidenceRule: 'A spatial PBR channel in the trusted reference requires delivered variation and reference/measured provenance bound to the locked ground-truth or input-image SHA-256 set.',
  },
  rigidMultiviewAudit,
  sourceViewSilhouette: {
    calibration: {
      strategy: 'evidence-constrained-single-global-azimuth-offset', offsetDegrees: calibration.offsetDegrees,
      candidates: calibrationCandidates.length,
      selection: 'maximize-worst-required-gate-margin',
      gateMargin: calibration.gateMargin,
      primaryMassWeight: primaryMassCalibrationWeight,
      thinFeatureWeight: thinFeatureCalibrationWeight,
      stepDegrees: cameraPoseEvidenceAudit.expectedStepDegrees,
      selectedCameraModelId: 'orthographic-e0-d4',
      cameraPoseEvidence: cameraPoseEvidenceAudit,
      sameCameraVisualClaimAllowed: false,
    },
    headPlanExtentInference: {
      ...headPlanExtentInference,
      appliedDiameterMm: headDiameterMm,
      appliedDepthMm: headDepthMm,
      sourceBandBounds: headBands,
    },
    views,
    minimumIoU: Math.min(...views.map((view) => view.silhouetteIoU)),
    meanIoU: views.reduce((sum, view) => sum + view.silhouetteIoU, 0) / views.length,
    threshold: 0.75,
    wholeAreaPass: silhouettePass,
    pass: silhouetteAudit.pass,
    audit: silhouetteAudit,
  },
  deliveryAudit: { pass: detailAudit.pass, blockers: detailAudit.blockers },
  productionBlockers: [
    'landmark coordinates were estimated by the multimodal planner rather than independently calibrated',
    ...cameraPoseEvidenceAudit.claimBlockers,
    ...pbrReferenceAudit.blockers.map((blocker) => `PBR: ${blocker}`),
    'hidden interfaces are not independently evidenced',
  ],
  dominanceBlockers: ['no same-input img2threejs candidate is available for a blind comparison'],
};
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, pass: report.pass, productionReady: report.productionReady, structure: report.structure, sourceViewSilhouette: report.sourceViewSilhouette, deliveryAudit: report.deliveryAudit }, null, 2));
if (process.argv.includes('--require-pass') && !report.pass) process.exitCode = 1;
