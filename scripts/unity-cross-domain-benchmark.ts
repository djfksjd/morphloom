import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { NodeIO } from '@gltf-transform/core';
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

interface UnityCase {
  id: string;
  pass: boolean;
  sourceSha256: string;
  gameObjects: number;
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  skinnedMeshes: number;
  bones: number;
  blendShapes: number;
  animationClips: number;
  animationNames: string[];
  boundsSizeMeters: number[];
  blockers: string[];
}

interface UnityRawReport {
  schema: string;
  unityVersion: string;
  generatedAt: string;
  pass: boolean;
  cases: UnityCase[];
}

interface SourceStats {
  meshes: number;
  vertices: number;
  triangles: number;
  materials: number;
  textures: number;
  skins: number;
  joints: number;
  morphTargets: number;
  animationClips: number;
  animationNames: string[];
  boundsSizeMeters: number[];
}

const fixtureDirectoryArgument = process.argv[2];
if (!fixtureDirectoryArgument) {
  throw new Error('Usage: npm run benchmark:unity-cross-domain -- <fixture-directory> [report.json]');
}
const fixtureDirectory = resolve(fixtureDirectoryArgument);
const reportPath = resolve(process.argv[3] ?? 'benchmarks/unity-cross-domain-latest.json');
const manifest = JSON.parse(readFileSync(resolve(fixtureDirectory, 'manifest.json'), 'utf8')) as FixtureManifest;
if (!manifest.pass || manifest.compilerRevision !== DELIVERY_PIPELINE_REVISION || manifest.results.length !== 5
  || manifest.results.some((result) => !result.byteDeterministic || result.sha256 !== result.repeatSha256
    || result.validation.status !== 'pass')) {
  throw new Error('Cross-domain fixture manifest is incomplete, stale, nondeterministic, or invalid.');
}

const unityBinary = process.env.MORPHLOOM_UNITY_BINARY
  || '/Applications/Unity/Hub/Editor/6000.5.3f1/Unity.app/Contents/MacOS/Unity';
const projectDirectory = resolve(fixtureDirectory, '.morphloom-unity-project');
if (basename(projectDirectory) !== '.morphloom-unity-project'
  || !projectDirectory.startsWith(`${fixtureDirectory}${sep}`)) {
  throw new Error(`Refusing to replace unsafe Unity project path: ${projectDirectory}`);
}
const assetDirectory = resolve(projectDirectory, 'Assets/MorphloomFixtures');
const editorDirectory = resolve(projectDirectory, 'Assets/Editor');
const rawReportPath = resolve(fixtureDirectory, 'unity-import-raw.json');
const unityLogPath = resolve(fixtureDirectory, 'unity-import.log');
rmSync(projectDirectory, { recursive: true, force: true });
mkdirSync(assetDirectory, { recursive: true });
mkdirSync(editorDirectory, { recursive: true });
mkdirSync(resolve(projectDirectory, 'Packages'), { recursive: true });
mkdirSync(resolve(projectDirectory, 'ProjectSettings'), { recursive: true });
for (const fixture of manifest.results) {
  if (!/^[a-z0-9-]{1,80}$/.test(fixture.id)) throw new Error(`Unsafe fixture id: ${fixture.id}`);
  const source = resolve(fixtureDirectory, `${fixture.id}.glb`);
  if (resolve(fixture.file) !== source) throw new Error(`${fixture.id} manifest file does not match its canonical fixture path.`);
  const bytes = readFileSync(source);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== fixture.sha256) throw new Error(`${fixture.id} fixture bytes do not match the signed manifest.`);
  cpSync(source, resolve(assetDirectory, basename(source)));
}
cpSync(resolve('scripts/unity/MorphloomUnityImportProof.cs'), resolve(editorDirectory, 'MorphloomUnityImportProof.cs'));
writeFileSync(resolve(projectDirectory, 'Packages/manifest.json'), `${JSON.stringify({
  dependencies: {
    'com.unity.cloud.gltfast': '6.20.0',
  },
}, null, 2)}\n`, 'utf8');
writeFileSync(resolve(projectDirectory, 'ProjectSettings/ProjectVersion.txt'), [
  'm_EditorVersion: 6000.5.3f1',
  'm_EditorVersionWithRevision: 6000.5.3f1',
  '',
].join('\n'), 'utf8');

const unity = spawnSync(unityBinary, [
  '-batchmode', '-nographics', '-quit',
  '-projectPath', projectDirectory,
  '-executeMethod', 'Morphloom.Editor.CrossDomainImportProof.Run',
  '-morphloomReport', rawReportPath,
  '-logFile', unityLogPath,
], { encoding: 'utf8', timeout: 100_000, maxBuffer: 64 * 1024 * 1024 });
if (unity.status !== 0) {
  const log = existsSync(unityLogPath) ? readFileSync(unityLogPath, 'utf8') : '';
  const licensingUnavailable = /No valid Unity Editor license found|Licensing initialization failed|connection with the Unity Licensing Client has been lost/i.test(log);
  const blockedReport = {
    schema: 'morphloom.unity-cross-domain-proof/0.1',
    compilerRevision: manifest.compilerRevision,
    generatedAt: new Date().toISOString(),
    pass: false,
    status: 'blocked',
    scope: 'actual Unity Editor + Unity glTFast native prefab import',
    environment: {
      requestedUnityVersion: '6000.5.3f1',
      glTFastVersion: '6.20.0',
      unityBinary,
    },
    blockers: [{
      code: licensingUnavailable ? 'unity-licensing-unavailable' : 'unity-editor-failed',
      detail: licensingUnavailable
        ? 'Unity licensing could not initialize on this host, so the Editor was stopped before asset import.'
        : `Unity Editor exited before a complete import report (status ${String(unity.status)}, signal ${String(unity.signal)}).`,
    }],
    cases: [],
  };
  writeFileSync(reportPath, `${JSON.stringify(blockedReport, null, 2)}\n`, 'utf8');
  throw new Error([
    `Unity failed (status ${String(unity.status)}, signal ${String(unity.signal)}).`,
    `stdout:\n${unity.stdout.slice(-2_000)}`,
    `stderr:\n${unity.stderr.slice(-2_000)}`,
    `log:\n${log.slice(-8_000)}`,
  ].join('\n'));
}
const raw = JSON.parse(readFileSync(rawReportPath, 'utf8')) as UnityRawReport;
if (raw.schema !== 'morphloom.unity-cross-domain-import/0.1' || raw.cases.length !== manifest.results.length) {
  throw new Error('Unity report schema or fixture count is invalid.');
}

function transformedBounds(root: Awaited<ReturnType<NodeIO['read']>>): number[] {
  const bounds = new THREE.Box3();
  const point = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  for (const scene of root.getRoot().listScenes()) {
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
  const document = await new NodeIO().read(path);
  const root = document.getRoot();
  const primitives = root.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  return {
    meshes: root.listMeshes().length,
    vertices: primitives.reduce((sum, primitive) => sum + (primitive.getAttribute('POSITION')?.getCount() ?? 0), 0),
    triangles: primitives.reduce((sum, primitive) => sum + Math.floor(
      (primitive.getIndices()?.getCount() ?? primitive.getAttribute('POSITION')?.getCount() ?? 0) / 3,
    ), 0),
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    skins: root.listSkins().length,
    joints: root.listSkins().reduce((sum, skin) => sum + skin.listJoints().length, 0),
    morphTargets: primitives.reduce((sum, primitive) => sum + primitive.listTargets().length, 0),
    animationClips: root.listAnimations().length,
    animationNames: root.listAnimations().map((animation) => animation.getName()).sort(),
    boundsSizeMeters: transformedBounds(document),
  };
}

function sortedSize(value: number[]): number[] {
  return value.slice().sort((left, right) => left - right);
}

const cases = [];
for (const fixture of manifest.results) {
  const imported = raw.cases.find((item) => item.id === fixture.id);
  if (!imported) throw new Error(`Unity omitted ${fixture.id}.`);
  const source = await inspectSource(resolve(fixtureDirectory, `${fixture.id}.glb`));
  const blockers = imported.blockers.slice();
  if (!imported.pass) blockers.push('Unity importer reported a failed native asset');
  if (imported.sourceSha256 !== fixture.sha256) blockers.push('Unity imported bytes differ from fixture SHA-256');
  if (imported.triangles !== source.triangles) blockers.push(`triangle drift ${source.triangles} -> ${imported.triangles}`);
  if (imported.vertices !== source.vertices) blockers.push(`vertex drift ${source.vertices} -> ${imported.vertices}`);
  if (imported.meshes < source.meshes) blockers.push(`mesh loss ${source.meshes} -> ${imported.meshes}`);
  if (imported.materials < source.materials) blockers.push(`material loss ${source.materials} -> ${imported.materials}`);
  if (imported.textures < source.textures) blockers.push(`texture loss ${source.textures} -> ${imported.textures}`);
  if (imported.animationClips !== source.animationClips) blockers.push(`animation clip drift ${source.animationClips} -> ${imported.animationClips}`);
  if (JSON.stringify(imported.animationNames.slice().sort()) !== JSON.stringify(source.animationNames)) {
    blockers.push('animation names were not preserved');
  }
  if (source.skins > 0 && (imported.skinnedMeshes === 0 || imported.bones < Math.min(...rootJointCounts(source)))) {
    blockers.push('skin or joint hierarchy was not preserved');
  }
  if (source.morphTargets > 0 && imported.blendShapes < source.morphTargets) blockers.push('morph targets were not preserved');
  const sourceSize = sortedSize(source.boundsSizeMeters);
  const importedSize = sortedSize(imported.boundsSizeMeters);
  const boundsErrorMm = Math.max(...sourceSize.map((value, index) => Math.abs(value - importedSize[index]!) * 1000));
  const boundsToleranceMm = source.skins > 0 ? 1 : 0.1;
  if (!Number.isFinite(boundsErrorMm) || boundsErrorMm > boundsToleranceMm) {
    blockers.push(`axis-normalized bounds drift ${boundsErrorMm.toFixed(3)} mm exceeds ${boundsToleranceMm.toFixed(3)} mm`);
  }
  cases.push({
    id: fixture.id,
    domain: fixture.domain,
    pass: blockers.length === 0,
    source,
    unity: imported,
    parity: { boundsErrorMm, boundsToleranceMm, blockers },
  });
}

function rootJointCounts(source: SourceStats): number[] {
  return source.skins > 0 ? [Math.max(1, Math.floor(source.joints / source.skins))] : [0];
}

const report = {
  schema: 'morphloom.unity-cross-domain-proof/0.1',
  compilerRevision: manifest.compilerRevision,
  generatedAt: new Date().toISOString(),
  pass: raw.pass && cases.length === 5 && cases.every((item) => item.pass),
  status: 'pass',
  scope: 'actual Unity Editor + Unity glTFast native prefab import with geometry, material, skin, morph, animation, source-byte and axis-normalized bounds parity',
  environment: {
    unityVersion: raw.unityVersion,
    glTFastVersion: '6.20.0',
    unityBinary,
  },
  blockers: [],
  cases,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
if (!report.pass) throw new Error('Unity cross-domain delivery proof failed.');
