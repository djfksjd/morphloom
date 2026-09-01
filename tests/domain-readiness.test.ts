import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { compileAssemblyIR } from '../src/engine/assembly-compiler';
import { ASPHALT_SURFACE_BENCHMARK_IR } from '../src/engine/asphalt-surface-benchmark';
import { buildCharacter } from '../src/engine/character';
import { auditDomainReadiness } from '../src/engine/domain-readiness';
import { buildOrnateKnife } from '../src/engine/knife';
import { parseOhpk } from '../src/engine/ohpk';
import { snapshotScene } from '../src/engine/delivery-validation';
import { analyzeTopology } from '../src/engine/topology';
import { DEFAULT_KNIFE_SPEC, DEFAULT_SPEC, FIELD_HUMAN_SPEC, type HumanPack } from '../src/types';
import type { AssemblyIR } from '../src/engine/assembly-ir';

let humanPack: HumanPack;

beforeAll(async () => {
  humanPack = await parseOhpk(
    new Uint8Array(readFileSync('public/assets/oxihuman-core-v1.ohpk')),
    async (payload) => new Uint8Array(inflateRawSync(payload)),
  );
});

describe('cross-domain semi-professional readiness', () => {
  it('exports a real weighted humanoid skeleton with a deterministic animation clip', () => {
    const first = buildCharacter(humanPack, DEFAULT_SPEC, 'beauty');
    const second = buildCharacter(humanPack, structuredClone(DEFAULT_SPEC), 'beauty');
    const firstSnapshot = snapshotScene(first.root);
    const secondSnapshot = snapshotScene(second.root);
    expect(first.body).toBeInstanceOf(THREE.SkinnedMesh);
    expect(firstSnapshot).toMatchObject({ skeletons: 1, bones: 49, animationClips: 1, animationTracks: 4 });
    expect(first.metrics.rig).toMatchObject({
      boneCount: 49,
      weightedVertices: first.metrics.vertices,
      maximumInfluences: 2,
      animationClips: 1,
      animationTracks: 4,
    });
    expect(first.body.skeleton.bones.map((bone) => bone.name)).toEqual(expect.arrayContaining([
      'toe_L', 'toe_R', 'thumb_03_L', 'index_03_L', 'middle_03_R', 'little_03_R',
    ]));
    const fingerBones = new Set(first.body.skeleton.bones
      .map((bone, index) => (/^(thumb|index|middle|ring|little)_/.test(bone.name) ? index : -1))
      .filter((index) => index >= 0));
    const skinIndex = first.body.geometry.getAttribute('skinIndex');
    const skinWeight = first.body.geometry.getAttribute('skinWeight');
    const position = first.body.geometry.getAttribute('position');
    first.root.updateMatrixWorld(true);
    const wristBySide = new Map(['L', 'R'].map((side) => {
      const wrist = first.body.skeleton.bones.find((bone) => bone.name === `wrist_${side}`)!;
      const tip = first.body.skeleton.bones.find((bone) => bone.name === `middle_03_${side}`)!;
      const wristPoint = first.body.worldToLocal(wrist.getWorldPosition(new THREE.Vector3()));
      const tipPoint = first.body.worldToLocal(tip.getWorldPosition(new THREE.Vector3()));
      return [side, { wrist: wristPoint, length: wristPoint.distanceTo(tipPoint) }] as const;
    }));
    let fingerWeightedVertices = 0;
    let mislocalizedFingerWeights = 0;
    for (let vertex = 0; vertex < skinIndex.count; vertex += 1) {
      for (const slot of [0, 1, 2, 3]) {
        const boneIndex = skinIndex.getComponent(vertex, slot);
        if (!fingerBones.has(boneIndex) || skinWeight.getComponent(vertex, slot) <= 0.001) continue;
        fingerWeightedVertices += 1;
        const side = first.body.skeleton.bones[boneIndex].name.endsWith('_L') ? 'L' : 'R';
        const hand = wristBySide.get(side)!;
        if (new THREE.Vector3().fromBufferAttribute(position, vertex).distanceTo(hand.wrist) > hand.length * 1.7) {
          mislocalizedFingerWeights += 1;
        }
        break;
      }
    }
    expect(fingerWeightedVertices).toBeGreaterThan(0);
    expect(mislocalizedFingerWeights).toBe(0);
    expect(first.metrics.rig.maximumWeightError).toBeLessThanOrEqual(1e-7);
    expect(secondSnapshot.fingerprint).toBe(firstSnapshot.fingerprint);
  });

  it('passes separate animation and real-time game contracts for the editable base', () => {
    const build = buildCharacter(humanPack, FIELD_HUMAN_SPEC, 'beauty');
    const repeated = buildCharacter(humanPack, structuredClone(FIELD_HUMAN_SPEC), 'beauty');
    const deterministic = snapshotScene(build.root).fingerprint === snapshotScene(repeated.root).fingerprint;
    const animation = auditDomainReadiness({
      domain: 'animation', root: build.root, evidenceScore: 90, deterministic, browserGlbRoundTrip: true,
    });
    const game = auditDomainReadiness({
      domain: 'game', root: build.root, evidenceScore: 90, deterministic, browserGlbRoundTrip: true,
    });
    expect(animation.blockers).toEqual([]);
    expect(animation.pass).toBe(true);
    expect(animation.score).toBeGreaterThanOrEqual(98);
    expect(animation.metrics).toMatchObject({ skeletons: 2, bones: 49, animationClips: 1, animationTracks: 4 });
    expect(animation.metrics.bindPoseRmsErrorMm).toBeLessThanOrEqual(0.01);
    expect(animation.metrics.deformationMovedVertices).toBeGreaterThan(0);
    expect(animation.metrics.deformationMaximumMm).toBeGreaterThan(1);
    expect(animation.metrics.fingerBones).toBe(30);
    expect(animation.metrics.fingerWeightedVertices).toBeGreaterThan(0);
    expect(animation.metrics.fingerAnimationTracks).toBe(2);
    expect(game.pass).toBe(true);
    expect(game.metrics.triangles).toBeLessThanOrEqual(100_000);
    expect(game.metrics.maximumSkinInfluences).toBeLessThanOrEqual(4);
    expect(game.metrics).toMatchObject({ gameLods: 2, collisionPrimitives: 2 });
    expect(game.warnings).toEqual([]);
    const lod1 = build.root.getObjectByName('LOD1_morphloom_human_body');
    expect(lod1).toBeInstanceOf(THREE.SkinnedMesh);
    expect((lod1 as THREE.SkinnedMesh).geometry.getAttribute('skinWeight')).toBeDefined();
    expect(((lod1 as THREE.SkinnedMesh).material as THREE.Material).opacity).toBe(1);
    expect(lod1!.layers.isEnabled(31)).toBe(true);
    expect(analyzeTopology(lod1 as THREE.SkinnedMesh).pass).toBe(true);
  }, 20_000);

  it('passes industrial-design and millimetre 3D-print contracts on appropriate assets', () => {
    const knife = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
    const knifeRepeat = buildOrnateKnife(structuredClone(DEFAULT_KNIFE_SPEC), 'beauty');
    const design = auditDomainReadiness({
      domain: 'industrial-design',
      root: knife.root,
      topology: knife.metrics.topology,
      evidenceScore: 90,
      deterministic: snapshotScene(knife.root).fingerprint === snapshotScene(knifeRepeat.root).fingerprint,
      browserGlbRoundTrip: true,
    });
    const asphalt = compileAssemblyIR(ASPHALT_SURFACE_BENCHMARK_IR, 'beauty');
    const print = auditDomainReadiness({
      domain: '3d-print',
      root: asphalt.root,
      topology: asphalt.metrics.topology,
      evidenceScore: 84,
      deterministic: true,
      browserGlbRoundTrip: true,
      sourceUnitMm: 1,
    });
    expect(design.pass).toBe(true);
    expect(print.pass).toBe(true);
    expect(print.metrics.minimumMeshAxisMm).toBeGreaterThan(0.4);
    expect(print.metrics.declaredMinimumFeatureMm).toBeGreaterThanOrEqual(0.8);
    expect(print.metrics.enclosedVolumeMm3).toBeGreaterThan(1);
    expect(print.metrics.unsupportedOverhangRatio).toBeLessThanOrEqual(0.01);
    expect(print.warnings).toEqual([]);
  }, 20_000);

  it('measures unsupported 45-degree overhangs instead of emitting a fixed print warning', () => {
    const material = { color: '#888888', surface: 'molded-polymer' as const, roughness: 0.7, microNormalStrength: 0.2 };
    const evidence = { status: 'measured' as const, source: 'print regression fixture' };
    const ir: AssemblyIR = {
      schema: 'morphloom.assembly/0.1', name: 'floating overhang fixture', units: 'mm',
      components: [
        { id: 'build_plate_base', name: 'Build plate base', category: 'mechanical', materialName: 'polymer', detail: 'Supported base', geometry: { op: 'roundedBox', size: [80, 10, 80], radius: 1 }, position: [0, 5, 0], material, evidence },
        { id: 'floating_shelf', name: 'Floating shelf', category: 'mechanical', materialName: 'polymer', detail: 'Unsupported horizontal shelf', geometry: { op: 'roundedBox', size: [60, 8, 60], radius: 1 }, position: [0, 54, 0], material, evidence },
      ],
    };
    const build = compileAssemblyIR(ir, 'beauty');
    const report = auditDomainReadiness({
      domain: '3d-print', root: build.root, topology: build.metrics.topology,
      evidenceScore: 100, deterministic: true, browserGlbRoundTrip: true, sourceUnitMm: 1,
    });
    expect(report.pass).toBe(true);
    expect(report.metrics.unsupportedOverhangAreaMm2).toBeGreaterThan(1_000);
    expect(report.metrics.unsupportedOverhangRatio).toBeGreaterThan(0.01);
    expect(report.warnings.join(' ')).toMatch(/print-overhang/);
  });

  it('fails closed instead of awarding animation or print readiness to an unqualified mesh', () => {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial());
    plane.name = 'unqualified_plane';
    const root = new THREE.Group();
    root.name = 'unqualified_root';
    root.add(plane);
    const animation = auditDomainReadiness({
      domain: 'animation', root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    const print = auditDomainReadiness({
      domain: '3d-print', root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(animation.pass).toBe(false);
    expect(animation.blockers.join(' ')).toMatch(/animation-skeleton|animation-weights|animation-clips/);
    expect(print.pass).toBe(false);
    expect(print.blockers.join(' ')).toMatch(/print-topology|print-units|print-declared-feature|print-volume/);
  });
});
