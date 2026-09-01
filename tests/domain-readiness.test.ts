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
import { HUMANOID_RUNTIME_CLIP_NAMES, humanoidAnimationDelivery } from '../src/engine/humanoid-rig';
import { DEFAULT_KNIFE_SPEC, DEFAULT_SPEC, FIELD_HUMAN_SPEC, type HumanPack } from '../src/types';
import type { AssemblyIR } from '../src/engine/assembly-ir';
import { LAUREL_HOMES_BUILDING_B_IR } from '../src/engine/laurel-homes-building-b';

let humanPack: HumanPack;

beforeAll(async () => {
  humanPack = await parseOhpk(
    new Uint8Array(readFileSync('public/assets/oxihuman-core-v1.ohpk')),
    async (payload) => new Uint8Array(inflateRawSync(payload)),
  );
});

describe('cross-domain semi-professional readiness', () => {
  it('requires the compiled architecture footprint to match its measured plan contract', () => {
    const build = compileAssemblyIR(LAUREL_HOMES_BUILDING_B_IR, 'beauty');
    const report = auditDomainReadiness({
      domain: 'architecture', root: build.root, topology: build.metrics.topology,
      evidenceScore: 100, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(report.pass).toBe(true);
    expect(report.checks.find((check) => check.id === 'architecture-plan')).toMatchObject({ pass: true, score: 100 });

    const reversed = structuredClone(LAUREL_HOMES_BUILDING_B_IR);
    const centerWing = reversed.components.find((component) => component.id === 'center_entry_wing_floor_slab');
    if (!centerWing?.position) throw new Error('Missing center wing fixture.');
    centerWing.position[2] = 3_800;
    const reversedBuild = compileAssemblyIR(reversed, 'beauty');
    const blocked = auditDomainReadiness({
      domain: 'architecture', root: reversedBuild.root, topology: reversedBuild.metrics.topology,
      evidenceScore: 100, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(blocked.pass).toBe(false);
    expect(blocked.blockers.some((blocker) => blocker.startsWith('architecture-plan:'))).toBe(true);
    expect(blocked.checks.find((check) => check.id === 'architecture-plan')?.detail).toMatch(/IoU|공백/);
  }, 20_000);

  it('exports a real weighted humanoid skeleton with a deterministic delivery animation set', () => {
    const first = buildCharacter(humanPack, DEFAULT_SPEC, 'beauty');
    const second = buildCharacter(humanPack, structuredClone(DEFAULT_SPEC), 'beauty');
    const firstSnapshot = snapshotScene(first.root);
    const secondSnapshot = snapshotScene(second.root);
    expect(first.body).toBeInstanceOf(THREE.SkinnedMesh);
    expect(firstSnapshot).toMatchObject({ skeletons: 1, bones: 49, animationClips: 22, animationTracks: 185, morphTargets: 5 });
    expect(firstSnapshot.morphTargetNames).toEqual(expect.arrayContaining([
      'morphloom_human_body:jaw_open', 'morphloom_human_body:smile',
      'morphloom_human_body:blink_L', 'morphloom_human_body:blink_R',
      'morphloom_human_body:brow_raise',
    ]));
    expect(first.metrics.facialMorphs).toMatchObject({ nonZeroTargets: 5 });
    expect(first.metrics.facialMorphs.affectedVertices).toBeGreaterThanOrEqual(100);
    expect(first.metrics.facialMorphs.maximumDisplacementMm).toBeGreaterThanOrEqual(0.5);
    expect(firstSnapshot.animationClipNames).toEqual([...HUMANOID_RUNTIME_CLIP_NAMES].sort());
    for (const clip of first.root.animations) {
      expect(clip.validate()).toBe(true);
      expect(clip.tracks.length).toBeGreaterThan(0);
      const delivery = humanoidAnimationDelivery(clip.name);
      expect(delivery).toBeDefined();
      for (const track of clip.tracks) {
        const stride = track.getValueSize();
        if (delivery?.loop) {
          expect(Array.from(track.values.slice(0, stride))).toEqual(
            Array.from(track.values.slice(track.values.length - stride)),
          );
        }
        const firstKey = Array.from(track.values.slice(0, stride));
        const hasMotion = Array.from({ length: track.times.length }, (_, key) => (
          Array.from(track.values.slice(key * stride, key * stride + stride))
        )).some((value) => value.some((component, index) => Math.abs(component - firstKey[index]) > 1e-7));
        expect(hasMotion, `${clip.name}:${track.name} should contain motion`).toBe(true);
        expect(first.body.skeleton.bones.some((bone) => track.name.startsWith(`${bone.name}.`))).toBe(true);
      }
    }
    expect(first.root.animations.find((clip) => clip.name === 'morphloom_walk_cycle')?.tracks.map((track) => track.name)).toEqual(expect.arrayContaining([
      'hips.position', 'hip_L.quaternion', 'hip_R.quaternion', 'knee_L.quaternion', 'knee_R.quaternion',
    ]));
    expect(first.root.animations.find((clip) => clip.name === 'morphloom_hand_gesture')?.tracks.filter((track) => /^(thumb|index|middle|ring|little)_/.test(track.name))).toHaveLength(10);
    expect(first.root.userData.gameDelivery).toMatchObject({
      schema: 'morphloom.game-delivery/0.4',
      animationSet: expect.arrayContaining([
        expect.objectContaining({ name: 'morphloom_idle_preview', tracks: 4, loop: true, category: 'idle', rootMotion: 'in-place' }),
        expect.objectContaining({ name: 'morphloom_sprint_cycle', tracks: 12, loop: true, category: 'locomotion' }),
        expect.objectContaining({ name: 'morphloom_jump_start', tracks: 8, loop: false, category: 'airborne', rootMotion: 'none' }),
        expect.objectContaining({ name: 'morphloom_point', tracks: 6, loop: false, category: 'gesture' }),
        expect.objectContaining({ name: 'morphloom_pick_up', tracks: 8, loop: false, category: 'interaction' }),
      ]),
    });
    expect(first.metrics.rig).toMatchObject({
      boneCount: 49,
      weightedVertices: first.metrics.vertices,
      maximumInfluences: 2,
      animationClips: 22,
      animationTracks: 185,
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
  }, 20_000);

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
    expect(animation.metrics).toMatchObject({ skeletons: 2, bones: 49, animationClips: 22, animationTracks: 185, animationSetCoverage: 1 });
    expect(animation.metrics.bindPoseRmsErrorMm).toBeLessThanOrEqual(0.01);
    expect(animation.metrics.deformationMovedVertices).toBeGreaterThan(0);
    expect(animation.metrics.deformationMaximumMm).toBeGreaterThan(1);
    expect(animation.metrics.fingerBones).toBe(30);
    expect(animation.metrics.fingerWeightedVertices).toBeGreaterThan(0);
    expect(animation.metrics.fingerAnimationTracks).toBeGreaterThanOrEqual(19);
    expect(animation.metrics.facialMorphTargets).toBe(5);
    expect(animation.metrics.facialMorphAffectedVertices).toBeGreaterThanOrEqual(100);
    expect(game.pass).toBe(true);
    expect(game.metrics.triangles).toBeLessThanOrEqual(100_000);
    expect(game.metrics.maximumSkinInfluences).toBeLessThanOrEqual(4);
    expect(game.metrics).toMatchObject({ gameLods: 2, collisionPrimitives: 2 });
    expect(game.metrics.collisionPrimitiveValidityCoverage).toBe(1);
    expect(game.metrics.collisionBoneCoverage).toBe(1);
    expect(game.metrics.collisionBoundsOverlapCoverage).toBe(1);
    expect(game.metrics.collisionVerticalCoverage).toBeGreaterThanOrEqual(0.75);
    expect(game.metrics.lodTriangleRatio).toBeGreaterThanOrEqual(0.1);
    expect(game.metrics.lodTriangleRatio).toBeLessThanOrEqual(0.85);
    expect(game.metrics.lodMonotonicTriangleReduction).toBe(true);
    expect(game.metrics.lodSkinWeightCoverage).toBe(1);
    expect(game.metrics.lodSkeletonCoverage).toBe(1);
    expect(game.metrics.lodNeutralBoundsError).toBeLessThanOrEqual(0.03);
    expect(game.metrics.lodNeutralSilhouetteEnvelopeError).toBeLessThanOrEqual(0.012);
    expect(game.metrics.lodPosedBoundsError).toBeLessThanOrEqual(0.04);
    expect(game.metrics.lodPosedSilhouetteEnvelopeError).toBeLessThanOrEqual(0.016);
    expect(game.metrics.animationSetCoverage).toBe(1);
    expect(game.warnings).toEqual([]);
    const lod1 = build.root.getObjectByName('LOD1_morphloom_human_body');
    expect(lod1).toBeInstanceOf(THREE.SkinnedMesh);
    expect((lod1 as THREE.SkinnedMesh).geometry.getAttribute('skinWeight')).toBeDefined();
    expect(((lod1 as THREE.SkinnedMesh).material as THREE.Material).opacity).toBe(1);
    expect(lod1!.layers.isEnabled(31)).toBe(true);
    expect(analyzeTopology(lod1 as THREE.SkinnedMesh).pass).toBe(true);
  }, 20_000);

  it('blocks a declared LOD that collapses the silhouette or loses valid skin weights', () => {
    const build = buildCharacter(humanPack, FIELD_HUMAN_SPEC, 'beauty');
    const lod = build.root.getObjectByName('LOD1_morphloom_human_body');
    if (!(lod instanceof THREE.SkinnedMesh)) throw new Error('Missing LOD1 fixture.');
    const position = lod.geometry.getAttribute('position');
    const originalX = Array.from({ length: position.count }, (_, vertex) => position.getX(vertex));
    for (let vertex = 0; vertex < position.count; vertex += 1) position.setX(vertex, position.getX(vertex) * 0.1);
    position.needsUpdate = true;
    const game = auditDomainReadiness({
      domain: 'game', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(game.pass).toBe(false);
    expect(game.blockers.some((blocker) => blocker.startsWith('game-lod-quality:'))).toBe(true);
    expect(game.metrics.lodNeutralBoundsError).toBeGreaterThan(0.03);

    for (let vertex = 0; vertex < position.count; vertex += 1) position.setX(vertex, originalX[vertex]!);
    position.needsUpdate = true;
    const manifest = build.root.userData.gameDelivery as { lods: Array<{ level: number; triangles: number; role: 'render' }> };
    manifest.lods.push({ level: 2, triangles: 1_000, role: 'render' });
    const missingDeclaredLod = auditDomainReadiness({
      domain: 'game', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(missingDeclaredLod.pass).toBe(false);
    expect(missingDeclaredLod.checks.find((check) => check.id === 'game-lod-quality')?.detail).toMatch(/1\/2 meshes/);
    manifest.lods.pop();

    const weights = lod.geometry.getAttribute('skinWeight');
    for (let vertex = 0; vertex < weights.count; vertex += 1) {
      for (let slot = 0; slot < 4; slot += 1) weights.setComponent(vertex, slot, 0);
    }
    weights.needsUpdate = true;
    const unskinned = auditDomainReadiness({
      domain: 'game', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(unskinned.pass).toBe(false);
    expect(unskinned.blockers.some((blocker) => blocker.startsWith('game-lod-quality:'))).toBe(true);
    expect(unskinned.metrics.lodSkinWeightCoverage).toBe(0);
  }, 20_000);

  it('blocks fake collision metadata with invalid dimensions or missing bone bindings', () => {
    const build = buildCharacter(humanPack, FIELD_HUMAN_SPEC, 'beauty');
    const manifest = build.root.userData.gameDelivery as {
      collisionPrimitives: Array<{ radius: number; bone: string }>;
    };
    manifest.collisionPrimitives[0]!.radius = Number.NaN;
    manifest.collisionPrimitives[1]!.bone = 'missing_head_bone';
    const game = auditDomainReadiness({
      domain: 'game', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(game.pass).toBe(false);
    expect(game.blockers.some((blocker) => blocker.startsWith('game-collision:'))).toBe(true);
    expect(game.metrics.collisionPrimitiveValidityCoverage).toBeLessThan(1);
    expect(game.metrics.collisionBoneCoverage).toBeLessThan(1);
  }, 20_000);

  it('blocks animation and game delivery when a required runtime clip is missing', () => {
    const build = buildCharacter(humanPack, FIELD_HUMAN_SPEC, 'beauty');
    build.root.animations = build.root.animations.filter((clip) => clip.name !== 'morphloom_run_cycle');
    const animation = auditDomainReadiness({
      domain: 'animation', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    const game = auditDomainReadiness({
      domain: 'game', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(animation.pass).toBe(false);
    expect(animation.blockers.join(' ')).toMatch(/animation-clips/);
    expect(game.pass).toBe(false);
    expect(game.blockers.join(' ')).toMatch(/game-runtime-motion/);
    expect(animation.metrics.animationSetCoverage).toBeCloseTo(21 / 22);
  }, 20_000);

  it('blocks animation and game delivery when required facial controls are absent', () => {
    const build = buildCharacter(humanPack, FIELD_HUMAN_SPEC, 'beauty');
    build.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.morphAttributes.position = [];
      object.morphTargetDictionary = {};
      object.morphTargetInfluences = [];
    });
    const animation = auditDomainReadiness({
      domain: 'animation', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    const game = auditDomainReadiness({
      domain: 'game', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(animation.pass).toBe(false);
    expect(game.pass).toBe(false);
    expect(animation.blockers.join(' ')).toMatch(/animation-facial-morphs/);
    expect(game.blockers.join(' ')).toMatch(/game-facial-morphs/);
  }, 20_000);

  it('blocks a clip set whose loop seam is visually discontinuous even when names and counts remain intact', () => {
    const build = buildCharacter(humanPack, FIELD_HUMAN_SPEC, 'beauty');
    const walk = build.root.animations.find((clip) => clip.name === 'morphloom_walk_cycle');
    const hip = walk?.tracks.find((track) => track.name === 'hip_L.quaternion');
    if (!hip) throw new Error('Missing walk hip track fixture.');
    hip.values[hip.values.length - 4] += 0.2;
    const animation = auditDomainReadiness({
      domain: 'animation', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    const game = auditDomainReadiness({
      domain: 'game', root: build.root, evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(animation.pass).toBe(false);
    expect(game.pass).toBe(false);
    expect(animation.blockers.join(' ')).toMatch(/animation-clip-quality/);
    expect(game.blockers.join(' ')).toMatch(/game-motion-quality/);
    expect(animation.metrics.animationLoopClosureCoverage).toBeLessThan(1);
    expect(animation.metrics.maximumAnimationQuaternionError).toBeGreaterThan(0.01);
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

  it('blocks placeholder UVs and invalid normals even when the attributes exist', () => {
    const broken = buildOrnateKnife(DEFAULT_KNIFE_SPEC, 'beauty');
    broken.root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const uv = object.geometry.getAttribute('uv');
      const normal = object.geometry.getAttribute('normal');
      if (uv) {
        for (let index = 0; index < uv.array.length; index += 1) uv.array[index] = 0;
        if (uv.array.length > 0) uv.array[0] = Number.NaN;
        uv.needsUpdate = true;
      }
      if (normal) {
        for (let index = 0; index < normal.array.length; index += 1) normal.array[index] = 0;
        normal.needsUpdate = true;
      }
    });
    const report = auditDomainReadiness({
      domain: 'industrial-design', root: broken.root, topology: broken.metrics.topology,
      evidenceScore: 100, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(report.pass).toBe(false);
    expect(report.blockers.some((blocker) => blocker.startsWith('design-uv:'))).toBe(true);
    expect(report.blockers.some((blocker) => blocker.startsWith('design-normals:'))).toBe(true);
    expect(report.metrics.uvFiniteCoverage).toBeLessThan(1);
    expect(report.metrics.degenerateUvTriangleFraction).toBeGreaterThan(0.99);
    expect(report.metrics.normalValidityCoverage).toBe(0);
  });

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

  it('blocks a watertight visual hull when its source-view reprojection remains inconsistent', () => {
    const left = Array.from({ length: 16 }, () => '1'.repeat(8) + '0'.repeat(8));
    const right = Array.from({ length: 16 }, () => '0'.repeat(8) + '1'.repeat(8));
    const build = compileAssemblyIR({
      schema: 'morphloom.assembly/0.1', name: 'miscalibrated visual hull', units: 'mm',
      components: [{
        id: 'miscalibrated_shell', name: 'Miscalibrated shell', category: 'enclosure', materialName: 'polymer',
        detail: 'Tolerance can preserve a review mesh but cannot erase a poor source-view score.',
        geometry: {
          op: 'visualHull',
          descriptor: {
            projection: 'orthographic', boundsSpace: 'component-local',
            bounds: { min: [-100, -100, -100], max: [100, 100, 100] },
            resolution: 8, triangleBudget: 400_000, silhouetteToleranceVoxels: 1,
            views: [
              { axis: 'front', confidence: 1, mask: left },
              { axis: 'top', confidence: 1, mask: right },
            ],
          },
        },
        material: { color: '#667788', surface: 'molded-polymer', microNormalStrength: 0.25 },
        evidence: { status: 'estimated', source: 'misaligned orthographic masks' },
      }],
    }, 'beauty');
    const report = auditDomainReadiness({
      domain: 'industrial-design', root: build.root, topology: build.metrics.topology,
      evidenceScore: 90, deterministic: true, browserGlbRoundTrip: true,
    });
    expect(build.metrics.topology.pass).toBe(true);
    expect(report.pass).toBe(false);
    expect(report.metrics.visualHullMeshes).toBe(1);
    expect(report.metrics.minimumVisualHullViewIoU).toBeLessThan(0.75);
    expect(report.blockers.join(' ')).toMatch(/visual-hull-projection/);
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
