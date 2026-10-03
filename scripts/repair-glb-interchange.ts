import { createHash } from 'node:crypto';
import { closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { WebIO, type Document, type Extension } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { copyToDocument, createDefaultPropertyResolver, prune } from '@gltf-transform/functions';
import { validateGlbStandard } from '../src/engine/gltf-standard-validation';

const [inputArgument, outputArgument, reportArgument, materialSourceArgument] = process.argv.slice(2);
if (!inputArgument || !outputArgument) {
  throw new Error('Usage: npm run gltf:repair -- <input.glb> <output.glb> [report.json] [material-source.glb]');
}
const inputPath = resolve(inputArgument);
const outputPath = resolve(outputArgument);
const materialSourcePath = materialSourceArgument ? resolve(materialSourceArgument) : null;
const reportPath = reportArgument ? resolve(reportArgument) : null;
// Preflight is for clear failures; exclusive opens below also guard creation races.
const destinations = [outputPath, ...(reportPath ? [reportPath] : [])];
const canonical = new Set<string>();
for (const path of destinations) {
  const key = join(realpathSync(dirname(path)), basename(path));
  if (canonical.has(key)) throw new Error('Output GLB and report must have distinct paths.');
  canonical.add(key);
  try {
    lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
    throw error;
  }
  throw new Error(`Output already exists; choose a new path: ${path}`);
}
if (inputPath === outputPath) throw new Error('Input and output GLB paths must differ.');
const input = readFileSync(inputPath);
if (input.byteLength < 20 || input.byteLength > 256 * 1024 * 1024) {
  throw new Error('Input GLB must be between 20 bytes and 256 MB.');
}

const io = new WebIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.readBinary(new Uint8Array(input.buffer, input.byteOffset, input.byteLength));
let restoredMaterials = 0;
let materialSourceSha256: string | null = null;
if (materialSourcePath) {
  if (materialSourcePath === outputPath) throw new Error('Material source and output GLB paths must differ.');
  const materialSource = readFileSync(materialSourcePath);
  if (materialSource.byteLength < 20 || materialSource.byteLength > 256 * 1024 * 1024) {
    throw new Error('Material source GLB must be between 20 bytes and 256 MB.');
  }
  materialSourceSha256 = createHash('sha256').update(materialSource).digest('hex');
  const sourceDocument = await io.readBinary(new Uint8Array(
    materialSource.buffer,
    materialSource.byteOffset,
    materialSource.byteLength,
  ));
  const sourceMaterials = sourceDocument.getRoot().listMaterials();
  const targetMaterials = document.getRoot().listMaterials();
  const sourceMeshNodes = sourceDocument.getRoot().listNodes().filter((node) => node.getMesh());
  const targetMeshNodes = document.getRoot().listNodes().filter((node) => node.getMesh());
  const stableNodeId = (node: (typeof sourceMeshNodes)[number]): string => {
    const candidate = node.getExtras().morphloomStableNodeId;
    return typeof candidate === 'string' && candidate ? candidate : node.getName();
  };
  const sourceNodeNames = sourceMeshNodes.map(stableNodeId);
  const targetNodeNames = targetMeshNodes.map(stableNodeId);
  if (sourceNodeNames.some((name) => !name) || new Set(sourceNodeNames).size !== sourceNodeNames.length) {
    throw new Error('Material source must contain unique non-empty mesh-node names.');
  }
  if (targetNodeNames.some((name) => !name) || new Set(targetNodeNames).size !== targetNodeNames.length) {
    throw new Error('Edited GLB must contain unique non-empty mesh-node names.');
  }
  if (sourceNodeNames.length !== targetNodeNames.length || targetNodeNames.some((name) => !sourceNodeNames.includes(name))) {
    throw new Error('Edited GLB mesh-node inventory does not match the material source.');
  }
  const targetExtensionNames = new Set(document.getRoot().listExtensionsUsed().map((extension) => extension.extensionName));
  for (const sourceExtension of sourceDocument.getRoot().listExtensionsUsed()) {
    if (targetExtensionNames.has(sourceExtension.extensionName)) continue;
    document.createExtension(sourceExtension.constructor as new (doc: Document) => Extension);
    targetExtensionNames.add(sourceExtension.extensionName);
  }
  const resolver = createDefaultPropertyResolver(document, sourceDocument);
  const copies = copyToDocument(document, sourceDocument, sourceMaterials, resolver);
  const copiedMaterials = new Map(sourceMaterials.map((sourceMaterial) => {
    const copied = copies.get(sourceMaterial);
    if (!copied) throw new Error(`Failed to copy material: ${sourceMaterial.getName()}`);
    return [sourceMaterial, copied as typeof sourceMaterial] as const;
  }));
  const sourceNodesByName = new Map(sourceMeshNodes.map((node) => [stableNodeId(node), node] as const));
  for (const targetNode of targetMeshNodes) {
    const targetNodeId = stableNodeId(targetNode);
    const sourceNode = sourceNodesByName.get(targetNodeId);
    const sourcePrimitives = sourceNode?.getMesh()?.listPrimitives() ?? [];
    const targetPrimitives = targetNode.getMesh()?.listPrimitives() ?? [];
    if (!sourceNode || sourcePrimitives.length !== targetPrimitives.length) {
      throw new Error(`Primitive inventory does not match for mesh node ${targetNodeId}.`);
    }
    targetNode.setName(targetNodeId);
    for (let index = 0; index < targetPrimitives.length; index += 1) {
      const sourceMaterial = sourcePrimitives[index]?.getMaterial();
      if (!sourceMaterial) {
        targetPrimitives[index]?.setMaterial(null);
        continue;
      }
      const replacement = copiedMaterials.get(sourceMaterial);
      if (!replacement) throw new Error(`Failed to resolve source material for ${targetNodeId}.`);
      targetPrimitives[index]?.setMaterial(replacement);
    }
  }
  for (const material of targetMaterials) material.dispose();
  restoredMaterials = copiedMaterials.size;
}
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

// Editable UVs and vertex attributes remain meaningful without a texture.
// Unused tangents were removed explicitly above; pruning must not erase UVs.
await document.transform(prune({ keepAttributes: true, keepSolidTextures: true, keepExtras: true }));
const output = await io.writeBinary(document);
const validation = await validateGlbStandard(output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength));
if (validation.status !== 'pass') {
  throw new Error(`Repaired GLB did not pass exact-byte validation: ${validation.issueCodes.join(', ') || validation.status}`);
}
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
  restoredMaterials,
  materialSourceSha256,
  validation,
};
const created: Array<{ path: string; dev: number; ino: number }> = [];
function writeOwned(path: string, data: Uint8Array | string): void {
  const descriptor = openSync(path, 'wx');
  try {
    const stat = fstatSync(descriptor);
    created.push({ path, dev: stat.dev, ino: stat.ino });
    writeFileSync(descriptor, data);
  } finally {
    closeSync(descriptor);
  }
}
try {
  writeOwned(outputPath, output);
  if (reportPath) writeOwned(reportPath, `${JSON.stringify(report, null, 2)}\n`);
} catch (error) {
  const cleanupErrors: unknown[] = [];
  for (const owned of created.reverse()) {
    try {
      const stat = lstatSync(owned.path);
      // A replacement created by another process is not ours to remove.
      if (stat.dev === owned.dev && stat.ino === owned.ino) unlinkSync(owned.path);
    } catch (cleanupError) {
      if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') cleanupErrors.push(cleanupError);
    }
  }
  if (cleanupErrors.length) throw new AggregateError([error, ...cleanupErrors], 'Output write failed; rollback incomplete.');
  throw error;
}
console.log(JSON.stringify(report, null, 2));
