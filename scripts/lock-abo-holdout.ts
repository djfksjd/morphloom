import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import {
  chooseSeededHoldout,
  isPathInside,
  readBoundedBody,
  safeAboSpinUrl,
  sha256,
} from './lib/holdout-lock';

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,95}$/;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const REQUIRED_AZIMUTHS = [0, 18, 36, 54] as const;
const REQUIRED_AZIMUTH_SET = new Set<number>(REQUIRED_AZIMUTHS);
const SOURCE_BASE = 'https://amazon-berkeley-objects.s3.amazonaws.com/spins/original/';
const PRODUCT_TYPE = /(LAMP|FAN|TABLE|CHAIR|FURNITURE|TOOL|APPLIANCE|ELECTRONIC|KITCHEN|HOME|LIGHT|CLOCK|VASE|BOTTLE|RUG|STORAGE)/;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const seedCommit = argument('--seed-commit');
const outputArgument = argument('--output');
const assetRootArgument = argument('--asset-root');
if (!seedCommit || !/^[a-f0-9]{40}$/.test(seedCommit) || !outputArgument || !assetRootArgument) {
  throw new Error('Usage: --seed-commit <40-hex precommitted revision> --output <benchmarks/holdouts/lock.json> --asset-root <work/abo/holdouts/case>');
}

const workspace = resolve('.');
const outputPath = resolve(outputArgument);
const assetRoot = resolve(assetRootArgument);
if (!isPathInside(resolve(workspace, 'benchmarks/holdouts'), outputPath)
  || !isPathInside(resolve(workspace, 'work/abo/holdouts'), assetRoot)) {
  throw new Error('Holdout output paths must stay inside their dedicated workspace directories.');
}
if (existsSync(outputPath) || existsSync(assetRoot)) {
  throw new Error('Holdout lock targets already exist; refusing to overwrite sealed evidence.');
}
try {
  execFileSync('git', ['cat-file', '-e', `${seedCommit}^{commit}`], {
    cwd: workspace,
    stdio: 'ignore',
    timeout: 5_000,
  });
} catch {
  throw new Error('Seed revision is not an existing local Git commit.');
}

const aboRoot = resolve(workspace, 'work/abo');
const modelIndexBytes = readFileSync(resolve(aboRoot, '3dmodels.csv.gz'));
const modelLines = gunzipSync(modelIndexBytes).toString('utf8').split('\n').slice(1);
// Deliberately admit only the identifier column. Shape, extent, mesh, and material fields stay hidden.
const modelIds = new Set(modelLines.flatMap((line) => {
  const comma = line.indexOf(',');
  const id = comma > 0 ? line.slice(0, comma) : '';
  return SAFE_ID.test(id) ? [id] : [];
}));

type SpinView = { azimuth: number; imageId: string; path: string };
const spinIndexBytes = readFileSync(resolve(aboRoot, 'spins.csv.gz'));
const spins = new Map<string, Map<number, SpinView>>();
for (const line of gunzipSync(spinIndexBytes).toString('utf8').split('\n').slice(1)) {
  const [spinId, azimuthRaw, imageId, _height, _width, path] = line.split(',');
  const azimuth = Number(azimuthRaw);
  if (!spinId || !SAFE_ID.test(spinId) || !imageId || !path || !REQUIRED_AZIMUTH_SET.has(azimuth)) continue;
  const views = spins.get(spinId) ?? new Map<number, SpinView>();
  views.set(azimuth, { azimuth, imageId, path });
  spins.set(spinId, views);
}

const exposureLedgerBytes = readFileSync(resolve(workspace, 'benchmarks/development-exposure-ledger.json'));
const exposureLedger = JSON.parse(exposureLedgerBytes.toString('utf8')) as {
  entries?: Array<{ sourceItemId?: unknown }>;
};
if (!Array.isArray(exposureLedger.entries)) throw new Error('Development exposure ledger has no entries array.');
const excludedItemIds = new Set(exposureLedger.entries.flatMap((entry) => (
  typeof entry.sourceItemId === 'string' && SAFE_ID.test(entry.sourceItemId) ? [entry.sourceItemId] : []
)));

type Candidate = {
  sourceItemId: string;
  spinId: string;
  title: string;
  productType: string;
  views: SpinView[];
};
const candidates: Candidate[] = [];
const seenCandidates = new Set<string>();
for (const filename of readdirSync(aboRoot).filter((name) => /^listings_[a-f0-9]\.json\.gz$/.test(name)).sort()) {
  const lines = gunzipSync(readFileSync(resolve(aboRoot, filename))).toString('utf8').split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const listing = JSON.parse(line) as {
      item_id?: unknown;
      spin_id?: unknown;
      item_name?: Array<{ language_tag?: unknown; value?: unknown }>;
      product_type?: Array<{ value?: unknown }>;
    };
    if (typeof listing.item_id !== 'string' || !SAFE_ID.test(listing.item_id)
      || typeof listing.spin_id !== 'string' || !SAFE_ID.test(listing.spin_id)
      || !modelIds.has(listing.item_id) || excludedItemIds.has(listing.item_id)) continue;
    const productTypeValue = listing.product_type?.[0]?.value;
    const productType = typeof productTypeValue === 'string' ? productTypeValue : '';
    if (!PRODUCT_TYPE.test(productType.toUpperCase())) continue;
    const indexedViews = spins.get(listing.spin_id);
    if (!indexedViews || REQUIRED_AZIMUTHS.some((azimuth) => !indexedViews.has(azimuth))) continue;
    const candidateKey = `${listing.item_id}:${listing.spin_id}`;
    if (seenCandidates.has(candidateKey)) continue;
    seenCandidates.add(candidateKey);
    const englishTitle = listing.item_name?.find((item) => (
      typeof item.language_tag === 'string' && item.language_tag.startsWith('en_') && typeof item.value === 'string'
    ))?.value;
    const firstTitle = listing.item_name?.find((item) => typeof item.value === 'string')?.value;
    const title = typeof englishTitle === 'string' ? englishTitle : typeof firstTitle === 'string' ? firstTitle : listing.item_id;
    candidates.push({
      sourceItemId: listing.item_id,
      spinId: listing.spin_id,
      title: title.slice(0, 240),
      productType: productType.slice(0, 96),
      views: REQUIRED_AZIMUTHS.map((azimuth) => indexedViews.get(azimuth)!),
    });
  }
}
const selected = chooseSeededHoldout(candidates, seedCommit);

mkdirSync(dirname(assetRoot), { recursive: true });
const stagingRoot = mkdtempSync(resolve(dirname(assetRoot), '.holdout-staging-'));
const lockedViews: Array<{
  id: string;
  sequenceIndex: number;
  relativeAzimuthDegrees: number;
  file: string;
  sourceUrl: string;
  sha256: string;
  bytes: number;
}> = [];
try {
  for (const [index, view] of selected.views.entries()) {
    const sourceUrl = safeAboSpinUrl(SOURCE_BASE, view.path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let bytes: Uint8Array;
    try {
      const response = await fetch(sourceUrl, { signal: controller.signal, redirect: 'error' });
      if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/jpeg') {
        throw new Error(`ABO holdout input download failed for azimuth ${view.azimuth}.`);
      }
      const contentLength = Number(response.headers.get('content-length'));
      if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
        throw new Error(`ABO holdout input exceeded the byte limit for azimuth ${view.azimuth}.`);
      }
      bytes = await readBoundedBody(response.body, MAX_IMAGE_BYTES);
    } finally {
      clearTimeout(timeout);
    }
    if (bytes.byteLength < 128 || bytes.byteLength > MAX_IMAGE_BYTES
      || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
      throw new Error(`ABO holdout input is not a complete bounded JPEG for azimuth ${view.azimuth}.`);
    }
    const filename = `view-${String(view.azimuth * 5).padStart(3, '0')}.jpg`;
    writeFileSync(resolve(stagingRoot, filename), bytes, { flag: 'wx' });
    lockedViews.push({
      id: ['front', 'right', 'rear', 'left'][index]!,
      sequenceIndex: view.azimuth,
      relativeAzimuthDegrees: view.azimuth * 5,
      file: relative(workspace, resolve(assetRoot, filename)),
      sourceUrl,
      sha256: sha256(bytes),
      bytes: bytes.byteLength,
    });
  }
  renameSync(stagingRoot, assetRoot);
} catch (error) {
  rmSync(stagingRoot, { recursive: true, force: true });
  throw error;
}

const lockedInput = {
  sourceDataset: 'Amazon Berkeley Objects',
  sourceItemId: selected.sourceItemId,
  spinId: selected.spinId,
  title: selected.title,
  productType: selected.productType,
  views: lockedViews.map(({ sha256: viewSha256, relativeAzimuthDegrees }) => ({
    sha256: viewSha256,
    relativeAzimuthDegrees,
  })),
};
const receipt = {
  schema: 'morphloom.holdout-input-lock/0.1',
  caseId: `abo-${selected.sourceItemId.toLowerCase()}-industrial-design`,
  domain: 'industrial-design',
  selectionProtocol: 'precommitted-random-sample',
  selectionAlgorithm: 'sha256(seedCommit:sourceItemId:spinId)-ascending-v1',
  seedCommit,
  inputLockedAt: new Date().toISOString(),
  lockedInputSha256: sha256(JSON.stringify(lockedInput)),
  developmentExposureLedgerSha256: sha256(exposureLedgerBytes),
  eligibility: {
    candidatePoolSize: candidates.length,
    hasFourOrthogonalSpinViews: true,
    groundTruthModelIndexPresence: true,
    groundTruthBytesRead: false,
    groundTruthUrlRecorded: false,
    modelIndexSha256: sha256(modelIndexBytes),
    spinIndexSha256: sha256(spinIndexBytes),
  },
  source: {
    sourceItemId: selected.sourceItemId,
    spinId: selected.spinId,
    title: selected.title,
    productType: selected.productType,
  },
  views: lockedViews,
  nextRequiredStep: 'Seal Morphloom and img2threejs candidate bytes before resolving or downloading the reference GLB.',
};
mkdirSync(dirname(outputPath), { recursive: true });
const outputStagingPath = `${outputPath}.tmp-${process.pid}`;
try {
  writeFileSync(outputStagingPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx' });
  renameSync(outputStagingPath, outputPath);
} catch (error) {
  rmSync(outputStagingPath, { force: true });
  rmSync(assetRoot, { recursive: true, force: true });
  throw error;
}
console.log(JSON.stringify({
  outputPath: relative(workspace, outputPath),
  caseId: receipt.caseId,
  candidatePoolSize: candidates.length,
  lockedInputSha256: receipt.lockedInputSha256,
  views: receipt.views.map((view) => ({ id: view.id, sha256: view.sha256, bytes: view.bytes })),
  groundTruthBytesRead: false,
}, null, 2));
