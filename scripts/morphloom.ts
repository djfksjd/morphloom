import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  inspectMorphloomJob,
  runMorphloomJob,
  type MorphloomJob,
  type MorphloomJobResult,
} from './lib/morphloom-job';

const MAX_JOB_BYTES = 16 * 1024 * 1024;

function usage(): never {
  throw new Error([
    'Usage:',
    '  npm run morphloom -- inspect --job <job.json>',
    '  npm run morphloom -- build --job <job.json> --out <output-directory>',
  ].join('\n'));
}

function option(name: string, args: string[]): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) usage();
  return value;
}

function resolveWithinWorkspace(requested: string, label: string, allowRoot = false): string {
  if (requested.includes('\0')) throw new Error(`${label} contains a null byte.`);
  const root = resolve(process.cwd());
  const target = resolve(root, requested);
  const relation = relative(root, target);
  if (isAbsolute(relation) || relation === '..' || relation.startsWith(`..${sep}`) || (!allowRoot && relation === '')) {
    throw new Error(`${label} must stay inside the current Morphloom workspace.`);
  }
  return target;
}

function assertNoSymlinkPath(target: string): void {
  const root = resolve(process.cwd());
  const relation = relative(root, target);
  let cursor = root;
  for (const segment of relation.split(sep).filter(Boolean)) {
    cursor = resolve(cursor, segment);
    if (existsSync(cursor) && lstatSync(cursor).isSymbolicLink()) {
      throw new Error(`Output path traverses a symbolic link: ${cursor}`);
    }
  }
}

function readJob(requestedPath: string): MorphloomJob {
  const path = resolveWithinWorkspace(requestedPath, 'Job path', true);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > MAX_JOB_BYTES) {
    throw new Error('Job must be a regular JSON file between 2 bytes and 16 MB.');
  }
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return parsed as MorphloomJob;
}

function atomicWrite(path: string, bytes: Uint8Array | string): void {
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  try {
    writeFileSync(temporary, bytes);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function serializableResult(result: MorphloomJobResult): Omit<MorphloomJobResult, 'glb'> {
  const { glb: _glb, ...report } = result;
  return report;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!command || !['inspect', 'build'].includes(command)) usage();
  const jobArgument = option('--job', args) ?? usage();
  const job = readJob(jobArgument);

  if (command === 'inspect') {
    const { inspection } = await inspectMorphloomJob(job, process.cwd());
    console.log(JSON.stringify(inspection, null, 2));
    if (inspection.blockers.length > 0) process.exitCode = 1;
    return;
  }

  const outputArgument = option('--out', args) ?? usage();
  const outputDirectory = resolveWithinWorkspace(outputArgument, 'Output directory');
  assertNoSymlinkPath(dirname(outputDirectory));
  if (existsSync(outputDirectory) && !lstatSync(outputDirectory).isDirectory()) {
    throw new Error('Output target exists and is not a directory.');
  }
  mkdirSync(outputDirectory, { recursive: true });
  assertNoSymlinkPath(outputDirectory);
  const reportPath = resolve(outputDirectory, 'run-report.json');
  const assetPath = resolve(outputDirectory, 'asset.glb');
  const assemblyPath = resolve(outputDirectory, 'assembly.resolved.json');
  if ([reportPath, assetPath, assemblyPath].some(existsSync)) {
    throw new Error('Morphloom output already exists; choose a new output directory.');
  }
  const result = await runMorphloomJob(job, process.cwd());
  atomicWrite(reportPath, `${JSON.stringify(serializableResult(result), null, 2)}\n`);
  if (result.glb) {
    const { assembly } = await inspectMorphloomJob(job, process.cwd());
    atomicWrite(assetPath, result.glb);
    atomicWrite(assemblyPath, `${JSON.stringify(assembly, null, 2)}\n`);
  }
  console.log(JSON.stringify({
    status: result.status,
    releaseAllowed: result.releaseAllowed,
    report: reportPath,
    glb: result.glb ? resolve(outputDirectory, 'asset.glb') : null,
    blockers: result.blockers,
  }, null, 2));
  if (result.status === 'blocked') process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Morphloom job failed.');
  process.exitCode = 1;
});
