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
import { DEFAULT_KNIFE_SPEC, DEFAULT_SPEC, type HumanPack } from '../src/types';

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
    expect(firstSnapshot).toMatchObject({ skeletons: 1, bones: 17, animationClips: 1, animationTracks: 2 });
    expect(first.metrics.rig).toMatchObject({
      boneCount: 17,
      weightedVertices: first.metrics.vertices,
      maximumInfluences: 2,
      animationClips: 1,
      animationTracks: 2,
    });
    expect(first.metrics.rig.maximumWeightError).toBeLessThanOrEqual(1e-7);
    expect(secondSnapshot.fingerprint).toBe(firstSnapshot.fingerprint);
  });

  it('passes separate animation and real-time game contracts for the editable base', () => {
    const build = buildCharacter(humanPack, DEFAULT_SPEC, 'beauty');
    const repeated = buildCharacter(humanPack, structuredClone(DEFAULT_SPEC), 'beauty');
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
    expect(animation.metrics).toMatchObject({ skeletons: 1, bones: 17, animationClips: 1, animationTracks: 2 });
    expect(game.pass).toBe(true);
    expect(game.metrics.triangles).toBeLessThanOrEqual(100_000);
    expect(game.metrics.maximumSkinInfluences).toBeLessThanOrEqual(4);
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
    expect(print.warnings).toContain('print-supports: 슬라이서별 서포트 생성은 후속 공정');
  }, 20_000);

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
