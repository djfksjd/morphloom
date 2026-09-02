import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { auditNeutralRenderSet, validateNeutralRenderReport, type NeutralRenderReport } from '../src/engine/neutral-render-proof';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith('--')) throw new Error(`Missing --${name}.`);
  return value;
}

function reportPaths(name: string): string[] {
  const paths = argument(name).split(',').map((path) => path.trim()).filter(Boolean).map((path) => resolve(path));
  if (paths.length < 2 || paths.length > 3) throw new Error(`--${name} must contain two or three comma-separated reports.`);
  return paths;
}

async function sha256(path: string): Promise<string> {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', rejectHash);
    stream.on('end', () => resolveHash(hash.digest('hex')));
  });
}

const artifactProofCache = new Map<string, Promise<{ bytes: number; sha256: string }>>();

function artifactProof(path: string, maximumBytes: number): Promise<{ bytes: number; sha256: string }> {
  const cached = artifactProofCache.get(path);
  if (cached) return cached;
  const pending = (async () => {
    const info = await stat(path);
    if (!info.isFile() || info.size < 1 || info.size > maximumBytes) {
      throw new Error(`Neutral artifact is outside the file budget: ${basename(path)}`);
    }
    return { bytes: info.size, sha256: await sha256(path) };
  })();
  artifactProofCache.set(path, pending);
  return pending;
}

async function readBoundedReport(path: string): Promise<NeutralRenderReport> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > 128 * 1024) throw new Error(`Neutral report is outside the 128 KB budget: ${basename(path)}`);
  const report = validateNeutralRenderReport(JSON.parse(await readFile(path, 'utf8')));
  const reportDirectory = await realpath(dirname(path));
  const sourcePath = await realpath(resolve(reportDirectory, report.source));
  const renderPath = await realpath(resolve(reportDirectory, report.render));
  if (dirname(sourcePath) !== reportDirectory || dirname(renderPath) !== reportDirectory) {
    throw new Error(`Neutral report artifacts must stay beside the report: ${basename(path)}`);
  }
  const [sourceProof, renderProof] = await Promise.all([
    artifactProof(sourcePath, 256 * 1024 * 1024), artifactProof(renderPath, 256 * 1024 * 1024),
  ]);
  if (sourceProof.bytes !== report.sourceBytes || sourceProof.sha256 !== report.sourceSha256) {
    throw new Error(`Neutral source receipt mismatch: ${basename(path)}`);
  }
  if (renderProof.bytes !== report.renderBytes || renderProof.sha256 !== report.renderSha256) {
    throw new Error(`Neutral render receipt mismatch: ${basename(path)}`);
  }
  return report;
}

const morphloomPaths = reportPaths('morphloom');
const competitorPaths = reportPaths('competitor');
const outputPath = resolve(argument('output'));
const [morphloom, competitor] = await Promise.all([
  Promise.all(morphloomPaths.map(readBoundedReport)),
  Promise.all(competitorPaths.map(readBoundedReport)),
]);
const audit = auditNeutralRenderSet(morphloom, competitor);
await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(audit, null, 2));
if (audit.status !== 'pass') process.exitCode = 1;
