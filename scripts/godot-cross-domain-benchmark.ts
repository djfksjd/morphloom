import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import * as THREE from 'three';
import { DELIVERY_PIPELINE_REVISION } from '../src/engine/delivery-validation';

interface FixtureManifest {
  pass: boolean;
  compilerRevision: string;
  results: Array<{
    id: string;
    domain: string;
    file: string;
    sha256: string;
    repeatSha256: string;
    byteDeterministic: boolean;
    validation: { status: string; errors: number; warnings: number };
  }>;
}

interface NativeStats {
  nodes: number;
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  texture_slots: number;
  skeletons: number;
  bones: number;
  skinned_meshes: number;
  blend_shapes: number;
  animation_clips: number;
  animation_names: string[];
  bounds_size_meters: number[];
  surface_relief?: ReliefStats;
}

interface ReliefStats {
  samples: number;
  rms_roughness_mm: number;
  peak_to_valley_mm: number;
}

interface GodotRawReport {
  schema: string;
  godot_version: string;
  pass: boolean;
  source: string;
  source_sha256: string;
  stats: NativeStats;
  blockers: string[];
}

interface SourceStats {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  textureSlots: number;
  skins: number;
  joints: number;
  maximumJointsPerSkin: number;
  morphTargets: number;
  animationClips: number;
  animationNames: string[];
  boundsSizeMeters: number[];
  surfaceRelief?: ReliefStats;
}

const MAXIMUM_REPORT_BYTES = 512 * 1024;
const MAXIMUM_LOG_BYTES = 8 * 1024 * 1024;

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function transformedBounds(document: Awaited<ReturnType<NodeIO['read']>>): number[] {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  for (const scene of document.getRoot().listScenes()) {
    scene.traverse((node) => {
      const mesh = node.getMesh();
      if (!mesh) return;
      matrix.fromArray(node.getWorldMatrix());
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        if (!position) continue;
        const minimum = position.getMinNormalized([]);
        const maximum = position.getMaxNormalized([]);
        for (const x of [minimum[0], maximum[0]]) for (const y of [minimum[1], maximum[1]]) {
          for (const z of [minimum[2], maximum[2]]) bounds.expandByPoint(point.set(x, y, z).applyMatrix4(matrix));
        }
      }
    });
  }
  return bounds.getSize(new THREE.Vector3()).toArray();
}

async function inspectSource(path: string): Promise<SourceStats> {
  const document = await new NodeIO().registerExtensions(ALL_EXTENSIONS).read(path);
  const root = document.getRoot();
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  const reliefSamples: number[] = [];
  const positionPoint = new THREE.Vector3();
  const normalPoint = new THREE.Vector3();
  const worldMatrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  for (const scene of root.listScenes()) {
    scene.traverse((node) => {
      if (node.getName() !== 'asphalt_core_sample') return;
      const mesh = node.getMesh();
      if (!mesh) return;
      worldMatrix.fromArray(node.getWorldMatrix());
      normalMatrix.getNormalMatrix(worldMatrix);
      for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION');
        const normal = primitive.getAttribute('NORMAL');
        if (!position || !normal || position.getCount() !== normal.getCount()) continue;
        const positionValues: number[] = [];
        const normalValues: number[] = [];
        for (let index = 0; index < position.getCount(); index += 1) {
          position.getElement(index, positionValues);
          normal.getElement(index, normalValues);
          normalPoint.set(normalValues[0] ?? 0, normalValues[1] ?? 0, normalValues[2] ?? 0)
            .applyMatrix3(normalMatrix).normalize();
          if (normalPoint.y <= 0.1) continue;
          positionPoint.set(positionValues[0] ?? 0, positionValues[1] ?? 0, positionValues[2] ?? 0)
            .applyMatrix4(worldMatrix);
          if (Number.isFinite(positionPoint.y)) reliefSamples.push(positionPoint.y * 1_000);
        }
      }
    });
  }
  let surfaceRelief: ReliefStats | undefined;
  if (reliefSamples.length > 0) {
    const mean = reliefSamples.reduce((sum, value) => sum + value, 0) / reliefSamples.length;
    let reliefMinimum = Number.POSITIVE_INFINITY;
    let reliefMaximum = Number.NEGATIVE_INFINITY;
    for (const value of reliefSamples) {
      reliefMinimum = Math.min(reliefMinimum, value);
      reliefMaximum = Math.max(reliefMaximum, value);
    }
    surfaceRelief = {
      samples: reliefSamples.length,
      rms_roughness_mm: Math.sqrt(reliefSamples.reduce((sum, value) => sum + (value - mean) ** 2, 0) / reliefSamples.length),
      peak_to_valley_mm: reliefMaximum - reliefMinimum,
    };
  }
  return {
    meshes: root.listMeshes().length,
    vertices: primitives.reduce((sum, primitive) => sum + (primitive.getAttribute('POSITION')?.getCount() ?? 0), 0),
    triangles: primitives.reduce((sum, primitive) => sum + Math.floor(
      (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3,
    ), 0),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    textureSlots: root.listMaterials().reduce((sum, material) => sum + [
      material.getBaseColorTexture(), material.getMetallicRoughnessTexture(), material.getNormalTexture(),
      material.getOcclusionTexture(), material.getEmissiveTexture(),
    ].filter(Boolean).length, 0),
    skins: root.listSkins().length,
    joints: root.listSkins().reduce((sum, skin) => sum + skin.listJoints().length, 0),
    maximumJointsPerSkin: Math.max(0, ...root.listSkins().map((skin) => skin.listJoints().length)),
    morphTargets: primitives.reduce((sum, primitive) => sum + primitive.listTargets().length, 0),
    animationClips: root.listAnimations().length,
    animationNames: root.listAnimations().map((animation) => animation.getName()).sort(),
    boundsSizeMeters: transformedBounds(document),
    ...(surfaceRelief ? { surfaceRelief } : {}),
  };
}

function sortedSize(values: number[]): number[] {
  return values.slice().sort((left, right) => left - right);
}

function validNativeStats(value: NativeStats): boolean {
  const integers = [value.nodes, value.meshes, value.vertices, value.triangles, value.materials, value.textures,
    value.texture_slots, value.skeletons, value.bones, value.skinned_meshes, value.blend_shapes, value.animation_clips];
  const reliefValid = value.surface_relief === undefined || (
    Number.isInteger(value.surface_relief.samples) && value.surface_relief.samples > 0
    && value.surface_relief.samples <= 100_000_000
    && Number.isFinite(value.surface_relief.rms_roughness_mm) && value.surface_relief.rms_roughness_mm > 0
    && Number.isFinite(value.surface_relief.peak_to_valley_mm) && value.surface_relief.peak_to_valley_mm > 0
  );
  return integers.every((item) => Number.isInteger(item) && item >= 0 && item <= 100_000_000)
    && Array.isArray(value.animation_names) && value.animation_names.length <= 1_024
    && value.animation_names.every((item) => typeof item === 'string' && item.length <= 160)
    && Array.isArray(value.bounds_size_meters) && value.bounds_size_meters.length === 3
    && value.bounds_size_meters.every((item) => Number.isFinite(item) && item > 0 && item < 1_000_000)
    && reliefValid;
}

const fixtureDirectoryArgument = process.argv[2];
if (!fixtureDirectoryArgument) {
  throw new Error('Usage: npm run benchmark:godot-cross-domain -- <fixture-directory> [report.json]');
}
const fixtureDirectory = resolve(fixtureDirectoryArgument);
const reportPath = resolve(process.argv[3] ?? 'benchmarks/godot-cross-domain-latest.json');
const manifestPath = resolve(fixtureDirectory, 'manifest.json');
const manifestInfo = statSync(manifestPath);
if (!manifestInfo.isFile() || manifestInfo.size < 32 || manifestInfo.size > 2 * 1024 * 1024) {
  throw new Error('Cross-domain fixture manifest exceeds its byte budget.');
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as FixtureManifest;
const requiredDomains = new Set(['architecture', 'industrial-design', 'electronics', 'animation-game', '3d-printing']);
if (!manifest.pass || manifest.compilerRevision !== DELIVERY_PIPELINE_REVISION || manifest.results.length !== requiredDomains.size
  || new Set(manifest.results.map((item) => item.domain)).size !== requiredDomains.size
  || manifest.results.some((item) => !requiredDomains.has(item.domain) || !item.byteDeterministic
    || item.sha256 !== item.repeatSha256 || item.validation.status !== 'pass'
    || item.validation.errors !== 0 || item.validation.warnings !== 0)) {
  throw new Error('Cross-domain fixture manifest is incomplete, stale, nondeterministic, or invalid.');
}

const godotBinary = resolve(process.env.MORPHLOOM_GODOT_BINARY
  || 'tmp/native-tools/godot/app/Godot.app/Contents/MacOS/Godot');
const binaryInfo = statSync(godotBinary);
if (!binaryInfo.isFile() || binaryInfo.size < 1_000_000 || binaryInfo.size > 1024 * 1024 * 1024) {
  throw new Error('Godot binary is missing or outside the executable byte budget.');
}
const projectDirectory = resolve(fixtureDirectory, '.morphloom-godot-project');
if (basename(projectDirectory) !== '.morphloom-godot-project'
  || !projectDirectory.startsWith(`${fixtureDirectory}${sep}`)) {
  throw new Error(`Refusing to replace unsafe Godot project path: ${projectDirectory}`);
}
rmSync(projectDirectory, { recursive: true, force: true });
mkdirSync(resolve(projectDirectory, 'fixtures'), { recursive: true });
writeFileSync(resolve(projectDirectory, 'project.godot'), [
  '; Generated native import proof project. Do not edit.',
  'config_version=5',
  '',
  '[application]',
  'config/name="Morphloom Native Import Proof"',
  '',
  '[rendering]',
  'renderer/rendering_method="gl_compatibility"',
  'renderer/rendering_method.mobile="gl_compatibility"',
  '',
].join('\n'), 'utf8');
cpSync(resolve('scripts/godot/MorphloomGodotImportProof.gd'), resolve(projectDirectory, 'import_proof.gd'));
for (const fixture of manifest.results) {
  if (!/^[a-z0-9-]{1,80}$/.test(fixture.id)) throw new Error(`Unsafe fixture id: ${fixture.id}`);
  const source = resolve(fixtureDirectory, `${fixture.id}.glb`);
  if (resolve(fixture.file) !== source) throw new Error(`${fixture.id} manifest path is not canonical.`);
  const bytes = readFileSync(source);
  if (sha256Bytes(bytes) !== fixture.sha256) throw new Error(`${fixture.id} bytes do not match the manifest.`);
  cpSync(source, resolve(projectDirectory, 'fixtures', `${fixture.id}.glb`));
}

const importLogPath = resolve(fixtureDirectory, 'godot-import.log');
const imported = spawnSync(godotBinary, [
  '--headless', '--editor', '--path', projectDirectory, '--import', '--log-file', importLogPath,
], { encoding: 'utf8', timeout: 300_000, maxBuffer: MAXIMUM_LOG_BYTES });
if (imported.status !== 0) {
  const log = readFileSync(importLogPath, 'utf8');
  throw new Error(`Godot import failed (${String(imported.status)}, ${String(imported.signal)}):\n${log.slice(-12_000)}`);
}
for (const fixture of manifest.results) {
  const importSettingsPath = resolve(projectDirectory, 'fixtures', `${fixture.id}.glb.import`);
  const settings = readFileSync(importSettingsPath, 'utf8');
  const compatibilitySettings = settings
    .replace('array_mesh/deduplicate_surfaces=true', 'array_mesh/deduplicate_surfaces=false')
    .replace('nodes/use_name_suffixes=true', 'nodes/use_name_suffixes=false')
    .replace('meshes/generate_lods=true', 'meshes/generate_lods=false')
    .replace('animation/remove_immutable_tracks=true', 'animation/remove_immutable_tracks=false');
  if (compatibilitySettings === settings) {
    throw new Error(`${fixture.id} Godot importer settings could not be hardened.`);
  }
  writeFileSync(importSettingsPath, compatibilitySettings, 'utf8');
}
const compatibilityImport = spawnSync(godotBinary, [
  '--headless', '--editor', '--path', projectDirectory, '--import', '--log-file', importLogPath,
], { encoding: 'utf8', timeout: 300_000, maxBuffer: MAXIMUM_LOG_BYTES });
if (compatibilityImport.status !== 0) {
  const log = readFileSync(importLogPath, 'utf8');
  throw new Error(`Godot compatibility reimport failed (${String(compatibilityImport.status)}, ${String(compatibilityImport.signal)}):\n${log.slice(-12_000)}`);
}

const cases = [];
for (const fixture of manifest.results) {
  const rawReportPath = resolve(fixtureDirectory, `${fixture.id}.godot.json`);
  if (existsSync(rawReportPath)) unlinkSync(rawReportPath);
  const launchedAt = Date.now();
  const executed = spawnSync(godotBinary, [
    '--headless', '--path', projectDirectory, '--script', 'res://import_proof.gd', '--',
    `res://fixtures/${fixture.id}.glb`, rawReportPath,
  ], { encoding: 'utf8', timeout: 180_000, maxBuffer: MAXIMUM_LOG_BYTES });
  if (executed.status !== 0) {
    throw new Error([
      `Godot audit failed for ${fixture.id} (${String(executed.status)}, ${String(executed.signal)}).`,
      `stdout:\n${executed.stdout.slice(-6_000)}`,
      `stderr:\n${executed.stderr.slice(-6_000)}`,
    ].join('\n'));
  }
  if (!existsSync(rawReportPath)) {
    throw new Error([
      `Godot did not write a fresh audit for ${fixture.id}.`,
      `stdout:\n${executed.stdout.slice(-6_000)}`,
      `stderr:\n${executed.stderr.slice(-6_000)}`,
    ].join('\n'));
  }
  const rawInfo = statSync(rawReportPath);
  if (!rawInfo.isFile() || rawInfo.mtimeMs + 1_000 < launchedAt
    || rawInfo.size < 32 || rawInfo.size > MAXIMUM_REPORT_BYTES) {
    throw new Error(`${fixture.id} Godot report exceeds its byte budget.`);
  }
  const raw = JSON.parse(readFileSync(rawReportPath, 'utf8')) as GodotRawReport;
  if (raw.schema !== 'morphloom.godot-cross-domain-import/0.1'
    || raw.source !== `res://fixtures/${fixture.id}.glb`
    || raw.source_sha256 !== fixture.sha256
    || !Array.isArray(raw.blockers) || raw.blockers.length > 128
    || !validNativeStats(raw.stats)) {
    throw new Error(`${fixture.id} Godot report is unsafe or does not match the signed fixture.`);
  }
  const source = await inspectSource(resolve(fixtureDirectory, `${fixture.id}.glb`));
  const blockers = raw.blockers.slice();
  if (!raw.pass) blockers.push('Godot importer reported a failed native asset.');
  if (raw.stats.triangles !== source.triangles) blockers.push(`triangle drift ${source.triangles} -> ${raw.stats.triangles}`);
  if (raw.stats.meshes < source.meshes) blockers.push(`mesh loss ${source.meshes} -> ${raw.stats.meshes}`);
  if (raw.stats.materials < source.materials) blockers.push(`material loss ${source.materials} -> ${raw.stats.materials}`);
  if (raw.stats.texture_slots < source.textureSlots) {
    blockers.push(`core PBR texture-slot loss ${source.textureSlots} -> ${raw.stats.texture_slots}`);
  }
  if (raw.stats.animation_clips !== source.animationClips) {
    blockers.push(`animation clip drift ${source.animationClips} -> ${raw.stats.animation_clips}`);
  }
  const godotAnimationNames = raw.stats.animation_names.map((name) => name.replace(/^.*\//, '')).sort();
  if (JSON.stringify(godotAnimationNames) !== JSON.stringify(source.animationNames)) {
    blockers.push('animation names were not preserved.');
  }
  if (source.skins > 0 && (raw.stats.skeletons < 1 || raw.stats.skinned_meshes < 1 || raw.stats.bones < source.maximumJointsPerSkin)) {
    blockers.push('skin or joint hierarchy was not preserved.');
  }
  if (source.morphTargets > 0 && raw.stats.blend_shapes < source.morphTargets) {
    blockers.push('morph targets were not preserved.');
  }
  const sourceSize = sortedSize(source.boundsSizeMeters);
  const nativeSize = sortedSize(raw.stats.bounds_size_meters);
  const boundsErrorMm = Math.max(...sourceSize.map((value, index) => Math.abs(value - nativeSize[index]!) * 1_000));
  const boundsToleranceMm = source.skins > 0 ? 1 : 0.1;
  if (!Number.isFinite(boundsErrorMm) || boundsErrorMm > boundsToleranceMm) {
    blockers.push(`axis-normalized bounds drift ${boundsErrorMm.toFixed(3)} mm exceeds ${boundsToleranceMm.toFixed(3)} mm.`);
  }
  let surfaceReliefParity: {
    rmsErrorMm: number;
    peakToValleyErrorMm: number;
    toleranceMm: number;
  } | undefined;
  if (fixture.domain === '3d-printing') {
    if (!source.surfaceRelief || !raw.stats.surface_relief) {
      blockers.push('surface relief could not be measured from both source GLB and native Godot vertices.');
    } else {
      const rmsErrorMm = Math.abs(source.surfaceRelief.rms_roughness_mm - raw.stats.surface_relief.rms_roughness_mm);
      const peakToValleyErrorMm = Math.abs(source.surfaceRelief.peak_to_valley_mm - raw.stats.surface_relief.peak_to_valley_mm);
      const toleranceMm = 0.02;
      surfaceReliefParity = { rmsErrorMm, peakToValleyErrorMm, toleranceMm };
      if (source.surfaceRelief.samples < 4_096
        || source.surfaceRelief.rms_roughness_mm <= 0.1
        || source.surfaceRelief.peak_to_valley_mm <= 0.5) {
        blockers.push('source GLB surface relief is missing or below the physical-scale regression floor.');
      }
      if (rmsErrorMm > toleranceMm || peakToValleyErrorMm > toleranceMm) {
        blockers.push(`native surface relief drift RMS ${rmsErrorMm.toFixed(3)} / P–V ${peakToValleyErrorMm.toFixed(3)} mm exceeds ${toleranceMm.toFixed(3)} mm.`);
      }
    }
  }
  cases.push({
    id: fixture.id,
    domain: fixture.domain,
    pass: blockers.length === 0,
    source,
    godot: raw,
    parity: { boundsErrorMm, boundsToleranceMm, ...(surfaceReliefParity ? { surfaceRelief: surfaceReliefParity } : {}), blockers },
  });
  console.log(`${fixture.id}: Godot ${blockers.length === 0 ? 'native import pass' : 'blocked'}`);
}

const report = {
  schema: 'morphloom.godot-cross-domain-proof/0.1',
  compilerRevision: manifest.compilerRevision,
  generatedAt: new Date().toISOString(),
  pass: cases.length === requiredDomains.size && cases.every((item) => item.pass),
  status: cases.every((item) => item.pass) ? 'pass' : 'blocked',
  scope: 'Actual Godot native PackedScene import with source-byte, geometry, material, texture, rig, animation, axis-normalized bounds, and delivered-vertex surface-relief parity.',
  environment: {
    godotVersion: cases[0]?.godot.godot_version ?? null,
    godotBinary,
    godotBinarySha256: sha256Bytes(readFileSync(godotBinary)),
  },
  cases,
  blockers: cases.flatMap((item) => item.parity.blockers.map((blocker) => `${item.id}: ${blocker}`)),
  limitation: 'This proves native Godot import integrity, not gameplay quality, physics tuning, target-device performance, or final art approval.',
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(`Wrote ${reportPath}`);
if (!report.pass) process.exitCode = 1;
