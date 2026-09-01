import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WebIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune } from '@gltf-transform/functions';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';

const [inputArgument, outputArgument, reportArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error('Usage: npm run gltf:repair -- <input.glb> <output.glb>');
}
const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
if (inputPath === outputPath) throw new Error('Input and output GLB paths must differ.');
const input = readFileSync(inputPath);
if (input.byteLength < 20 || input.byteLength > 256 * 1024 * 1024) {
  throw new Error('Input GLB must be between 20 bytes and 256 MB.');
}

const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.readBinary(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
let tangentAccessors = 0;
let repairedTangents = 0;
let removedUnusedTangentAccessors = 0;
for (const mesh of document.getRoot().listMeshes()) {
  for (const primitive of mesh.listPrimitives()) {
    const tangent = primitive.getAttribute('TANGENT');
    if (!tangent) continue;
    const material = primitive.getMaterial();
    if (!material?.getNormalTexture()) {
      primitive.setAttribute('TANGENT', null);
      removedUnusedTangentAccessors += 1;
      continue;
    }
    const normal = primitive.getAttribute('NORMAL');
    if (!normal || normal.getCount() !== tangent.getCount()) {
      throw new Error(`Normal-mapped primitive in ${mesh.getName() || 'unnamed mesh'} has incompatible tangent inputs.`);
    }
    tangentAccessors += 1;
    const tangentValue = [0, 0, 0, 1];
    const normalValue = [0, 0, 1];
    for (let index = 0; index < tangent.getCount(); index += 1) {
      tangent.getElement(index, tangentValue);
      normal.getElement(index, normalValue);
      let [x, y, z, w] = tangentValue;
      const length = Math.hypot(x, y, z);
      if (!Number.isFinite(length) || length <= 1e-12) {
        const [nx, ny, nz] = normalValue;
        if (Math.abs(nx) < 0.9) {
          x = 0;
          y = nz;
          z = -ny;
        } else {
          x = -nz;
          y = 0;
          z = nx;
        }
        const fallbackLength = Math.hypot(x, y, z);
        x /= fallbackLength;
        y /= fallbackLength;
        z /= fallbackLength;
        w = 1;
        repairedTangents += 1;
      } else {
        x /= length;
        y /= length;
        z /= length;
        if (w !== -1 && w !== 1) {
          w = 1;
          repairedTangents += 1;
        } else if (Math.abs(length - 1) > 0.0005) {
          repairedTangents += 1;
        }
      }
      tangent.setElement(index, [x, y, z, w]);
    }
  }
}

await document.transform(prune({ keepAttributes: false, keepSolidTextures: true, keepExtras: true }));
const output = await io.writeBinary(document);
const validation = await validateGlbStandard(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength));
if (validation.status !== 'pass') {
  throw new Error(`Repaired GLB did not pass exact-byte validation: ${validation.issueCodes.join(', ') || validation.status}`);
}
writeFileSync(outputPath, output);
const report = {
  schema: 'morphloom.gltf-interchange-repair/0.1',
  pass: true,
  input: inputPath,
  output: outputPath,
  inputBytes: input.byteLength,
  outputBytes: output.byteLength,
  outputSha256: createHash('sha256').update(output).digest('hex'),
  tangentAccessors,
  repairedTangents,
  removedUnusedTangentAccessors,
  validation,
};
if (reportArgument) writeFileSync(resolve(reportArgument), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
