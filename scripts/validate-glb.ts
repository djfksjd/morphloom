import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('Usage: npm run gltf:validate -- <asset.glb> [more.glb]');
  process.exitCode = 2;
} else {
  const reports = [];
  for (const requestedPath of paths) {
    const path = resolve(requestedPath);
    const file = readFileSync(path);
    const bytes = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
    const validation = await validateGlbStandard(bytes);
    reports.push({ path, bytes: file.byteLength, ...validation });
  }
  console.log(JSON.stringify({
    schema: 'morphloom.khronos-gltf-validation/0.1',
    pass: reports.every((report) => report.status === 'pass'),
    reports,
  }, null, 2));
  if (reports.some((report) => report.status !== 'pass')) process.exitCode = 1;
}
