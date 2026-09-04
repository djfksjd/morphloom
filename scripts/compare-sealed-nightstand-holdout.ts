import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compareSurfaceGeometry, sampleTriangleSurface } from '../src/engine/surface-geometry-fidelity';
import { collectGltfTriangles } from './lib/semantic-product-pilot';

const ROOT = resolve('.');
const LOCK_PATH = resolve('benchmarks/holdouts/abo-industrial-design-01-lock.json');
const MORPHLOOM_RECEIPT_PATH = resolve('benchmarks/holdouts/abo-industrial-design-01-morphloom-3750dcd.json');
const COMPETITOR_RECEIPT_PATH = resolve('benchmarks/holdouts/abo-industrial-design-01-img2threejs-web-9fbd0ca.json');
const GROUND_TRUTH_PATH = resolve('work/abo/holdouts/industrial-design-01/ground-truth.glb');
const OUTPUT_PATH = resolve('benchmarks/holdouts/abo-industrial-design-01-comparison.json');
const SAMPLE_COUNT = 4_096;
const MAX_GLB_BYTES = 256 * 1024 * 1024;

interface CandidateReceipt {
  caseId: string;
  lockedInputSha256?: string;
  engine?: string;
  competitor?: { name?: string; repositoryRevision?: string };
  engineRevision?: string;
  artifact: { file: string; sha256: string; bytes: number };
  groundTruthRevealed: boolean;
  sealedAt: string;
}

interface HoldoutLock {
  caseId: string;
  lockedInputSha256: string;
  inputLockedAt: string;
  source: { sourceItemId: string; title: string; productType: string };
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function assertSafeFile(path: string): void {
  const rel = relative(ROOT, path);
  if (rel.startsWith('..') || rel === '' || rel.includes('\0')) throw new Error(`Unsafe comparison path: ${path}`);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size < 12 || stat.size > MAX_GLB_BYTES) {
    throw new Error(`Comparison input is outside the 12-byte..256-MB budget: ${path}`);
  }
}

function verifyReceipt(lock: HoldoutLock, receipt: CandidateReceipt): string {
  if (receipt.caseId !== lock.caseId
    || (receipt.lockedInputSha256 !== undefined && receipt.lockedInputSha256 !== lock.lockedInputSha256)) {
    throw new Error('Candidate receipt does not bind to the locked holdout input.');
  }
  if (receipt.groundTruthRevealed !== false) throw new Error('Candidate was not sealed before ground-truth reveal.');
  const artifactPath = resolve(receipt.artifact.file);
  assertSafeFile(artifactPath);
  const actualHash = sha256(artifactPath);
  const actualBytes = statSync(artifactPath).size;
  if (actualHash !== receipt.artifact.sha256 || actualBytes !== receipt.artifact.bytes) {
    throw new Error(`Candidate artifact does not match its seal: ${receipt.artifact.file}`);
  }
  return artifactPath;
}

function documentInventory(document: Awaited<ReturnType<NodeIO['read']>>) {
  const root = document.getRoot();
  return {
    scenes: root.listScenes().length,
    nodes: root.listNodes().length,
    meshes: root.listMeshes().length,
    materials: root.listMaterials().length,
    textures: root.listTextures().length,
    animations: root.listAnimations().length,
    skins: root.listSkins().length,
  };
}

const lock = readJson<HoldoutLock>(LOCK_PATH);
const morphloomReceipt = readJson<CandidateReceipt>(MORPHLOOM_RECEIPT_PATH);
const competitorReceipt = readJson<CandidateReceipt>(COMPETITOR_RECEIPT_PATH);
const morphloomPath = verifyReceipt(lock, morphloomReceipt);
const competitorPath = verifyReceipt(lock, competitorReceipt);
assertSafeFile(GROUND_TRUTH_PATH);

// A timestamp ordering check makes the blind boundary machine-auditable without
// pretending that filesystem mtimes prove when the public reference was fetched.
for (const receipt of [morphloomReceipt, competitorReceipt]) {
  if (!Number.isFinite(Date.parse(receipt.sealedAt)) || Date.parse(receipt.sealedAt) <= Date.parse(lock.inputLockedAt)) {
    throw new Error('Candidate seal timestamp must be later than the input lock.');
  }
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const [groundTruthDocument, morphloomDocument, competitorDocument] = await Promise.all([
  io.read(GROUND_TRUTH_PATH), io.read(morphloomPath), io.read(competitorPath),
]);
const groundTruthSample = sampleTriangleSurface(collectGltfTriangles(groundTruthDocument), SAMPLE_COUNT);

function auditCandidate(document: Awaited<ReturnType<NodeIO['read']>>) {
  const sample = sampleTriangleSurface(collectGltfTriangles(document), SAMPLE_COUNT);
  return {
    inventory: documentInventory(document),
    sourceTriangles: sample.sourceTriangles,
    surfaceAreaSquareMeters: sample.surfaceArea,
    geometry: compareSurfaceGeometry(groundTruthSample.points, sample.points),
  };
}

const morphloom = auditCandidate(morphloomDocument);
const img2threejs = auditCandidate(competitorDocument);
const lowerRatio = (left: number, right: number) => right === 0 ? null : left / right;
const higherRatio = (left: number, right: number) => right === 0 ? null : left / right;
const dominanceChecks = [
  {
    metric: 'maximum-dimension-relative-error', direction: 'lower-is-better',
    morphloom: morphloom.geometry.maximumDimensionRelativeError,
    img2threejs: img2threejs.geometry.maximumDimensionRelativeError,
    morphloomToCompetitorRatio: lowerRatio(morphloom.geometry.maximumDimensionRelativeError, img2threejs.geometry.maximumDimensionRelativeError),
    winner: morphloom.geometry.maximumDimensionRelativeError < img2threejs.geometry.maximumDimensionRelativeError ? 'morphloom' : 'img2threejs',
  },
  {
    metric: 'symmetric-rms-chamfer', direction: 'lower-is-better',
    morphloom: morphloom.geometry.symmetricRmsChamfer,
    img2threejs: img2threejs.geometry.symmetricRmsChamfer,
    morphloomToCompetitorRatio: lowerRatio(morphloom.geometry.symmetricRmsChamfer, img2threejs.geometry.symmetricRmsChamfer),
    winner: morphloom.geometry.symmetricRmsChamfer < img2threejs.geometry.symmetricRmsChamfer ? 'morphloom' : 'img2threejs',
  },
  {
    metric: 'minimum-surface-coverage', direction: 'higher-is-better',
    morphloom: morphloom.geometry.minimumCoverage,
    img2threejs: img2threejs.geometry.minimumCoverage,
    morphloomToCompetitorRatio: higherRatio(morphloom.geometry.minimumCoverage, img2threejs.geometry.minimumCoverage),
    winner: morphloom.geometry.minimumCoverage > img2threejs.geometry.minimumCoverage ? 'morphloom' : 'img2threejs',
  },
] as const;

const report = {
  schema: 'morphloom.sealed-holdout-comparison/0.1',
  protocol: {
    kind: 'post-seal-ground-truth-reveal',
    caseId: lock.caseId,
    sourceItemId: lock.source.sourceItemId,
    lockedInputSha256: lock.lockedInputSha256,
    candidateSealsPrecedeGroundTruthReveal: true,
    limitation: 'This single industrial-design holdout establishes only case-level evidence. It does not prove all-domain dominance or material appearance fidelity.',
  },
  groundTruth: {
    source: 'Amazon Berkeley Objects public 3D model corpus',
    license: 'CC BY 4.0',
    localFile: relative(ROOT, GROUND_TRUTH_PATH),
    sha256: sha256(GROUND_TRUTH_PATH),
    bytes: statSync(GROUND_TRUTH_PATH).size,
    inventory: documentInventory(groundTruthDocument),
    sourceTriangles: groundTruthSample.sourceTriangles,
    surfaceAreaSquareMeters: groundTruthSample.surfaceArea,
  },
  candidates: {
    morphloom: {
      seal: relative(ROOT, MORPHLOOM_RECEIPT_PATH), artifactSha256: morphloomReceipt.artifact.sha256,
      engineRevision: morphloomReceipt.engineRevision,
      cryptographicLockBinding: morphloomReceipt.lockedInputSha256 === lock.lockedInputSha256,
      ...morphloom,
    },
    img2threejs: {
      seal: relative(ROOT, COMPETITOR_RECEIPT_PATH), artifactSha256: competitorReceipt.artifact.sha256,
      engineRevision: competitorReceipt.engineRevision ?? competitorReceipt.competitor?.repositoryRevision,
      cryptographicLockBinding: competitorReceipt.lockedInputSha256 === lock.lockedInputSha256,
      sealLimitation: competitorReceipt.lockedInputSha256 === undefined
        ? 'The competitor seal predates explicit lockedInputSha256 embedding; caseId and immutable Git history provide weaker binding.'
        : undefined,
      ...img2threejs,
    },
  },
  verdict: {
    morphloomMetricWins: dominanceChecks.filter((check) => check.winner === 'morphloom').length,
    comparedMetrics: dominanceChecks.length,
    dominanceChecks,
    morphloomStrictGeometryPass: morphloom.geometry.pass,
    img2threejsStrictGeometryPass: img2threejs.geometry.pass,
    conclusion: dominanceChecks.every((check) => check.winner === 'morphloom')
      ? 'Morphloom wins all three predeclared geometry metrics on this sealed holdout, but remains below the strict semi-professional geometry gate.'
      : 'Morphloom does not win every predeclared geometry metric on this sealed holdout.',
  },
};

writeFileSync(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: relative(ROOT, OUTPUT_PATH), verdict: report.verdict }, null, 2));
