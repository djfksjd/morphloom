const GLB_MAGIC = 0x46546c67;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const MAX_GLB_BYTES = 256 * 1024 * 1024;

interface GlbBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  [key: string]: unknown;
}

interface GlbImage {
  bufferView?: number;
  [key: string]: unknown;
}

interface GlbJson {
  buffers?: Array<{ byteLength: number; [key: string]: unknown }>;
  bufferViews?: GlbBufferView[];
  images?: GlbImage[];
  [key: string]: unknown;
}

function align4(value: number): number {
  return (value + 3) & ~3;
}

/**
 * GLTFExporter encodes textures concurrently, so equivalent images can claim
 * buffer-view slots in completion order and make otherwise identical GLBs
 * byte-different. This rewrites exporter-produced GLBs into image-index order
 * while preserving every logical buffer-view reference.
 */
export function canonicalizeGlbBufferViews(input: ArrayBuffer): ArrayBuffer {
  if (input.byteLength < 28 || input.byteLength > MAX_GLB_BYTES) {
    throw new Error('GLB canonicalization requires a 28-byte to 256MB payload.');
  }
  const source = new Uint8Array(input);
  const view = new DataView(input);
  if (view.getUint32(0, true) !== GLB_MAGIC || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== input.byteLength) {
    throw new Error('GLB canonicalization received an invalid header.');
  }
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== JSON_CHUNK || jsonLength < 2 || 20 + jsonLength + 8 > input.byteLength) {
    throw new Error('GLB canonicalization requires a leading JSON chunk and a BIN chunk.');
  }
  const binHeader = 20 + jsonLength;
  const binLength = view.getUint32(binHeader, true);
  if (view.getUint32(binHeader + 4, true) !== BIN_CHUNK || binHeader + 8 + binLength !== input.byteLength) {
    throw new Error('GLB canonicalization requires one complete BIN chunk.');
  }
  const json = JSON.parse(new TextDecoder().decode(source.subarray(20, 20 + jsonLength)).trim()) as GlbJson;
  const bufferViews = json.bufferViews;
  const images = json.images ?? [];
  if (!bufferViews || !json.buffers?.[0] || images.length < 2) return input;

  const binStart = binHeader + 8;
  const imageEntries = images
    .map((image, imageIndex) => ({ image, imageIndex, bufferView: image.bufferView }))
    .filter((entry): entry is { image: GlbImage; imageIndex: number; bufferView: number } => Number.isSafeInteger(entry.bufferView));
  if (imageEntries.length < 2) return input;
  const imageViewIndices = imageEntries.map((entry) => entry.bufferView);
  if (new Set(imageViewIndices).size !== imageViewIndices.length) {
    throw new Error('GLB canonicalization does not support images sharing one buffer view.');
  }
  for (const index of imageViewIndices) {
    if (index < 0 || index >= bufferViews.length) throw new Error('GLB image references an invalid buffer view.');
  }

  const originalData = bufferViews.map((bufferView) => {
    if (bufferView.buffer !== 0 || !Number.isSafeInteger(bufferView.byteLength) || bufferView.byteLength < 0) {
      throw new Error('GLB canonicalization supports one finite embedded buffer.');
    }
    const offset = bufferView.byteOffset ?? 0;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset + bufferView.byteLength > binLength) {
      throw new Error('GLB buffer view exceeds the BIN chunk.');
    }
    return source.slice(binStart + offset, binStart + offset + bufferView.byteLength);
  });
  const targetImageViews = [...imageViewIndices].sort((left, right) => left - right);
  const replacement = new Map<number, Uint8Array>();
  imageEntries.sort((left, right) => left.imageIndex - right.imageIndex).forEach((entry, index) => {
    const target = targetImageViews[index];
    replacement.set(target, originalData[entry.bufferView]);
    entry.image.bufferView = target;
  });

  const rewrittenData = originalData.map((data, index) => replacement.get(index) ?? data);
  let rebuiltBinLength = 0;
  for (let index = 0; index < bufferViews.length; index += 1) {
    rebuiltBinLength = align4(rebuiltBinLength);
    bufferViews[index].byteOffset = rebuiltBinLength;
    bufferViews[index].byteLength = rewrittenData[index].byteLength;
    rebuiltBinLength += rewrittenData[index].byteLength;
  }
  rebuiltBinLength = align4(rebuiltBinLength);
  json.buffers[0].byteLength = rebuiltBinLength;

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const paddedJsonLength = align4(jsonBytes.byteLength);
  const output = new Uint8Array(12 + 8 + paddedJsonLength + 8 + rebuiltBinLength);
  const outputView = new DataView(output.buffer);
  outputView.setUint32(0, GLB_MAGIC, true);
  outputView.setUint32(4, 2, true);
  outputView.setUint32(8, output.byteLength, true);
  outputView.setUint32(12, paddedJsonLength, true);
  outputView.setUint32(16, JSON_CHUNK, true);
  output.fill(0x20, 20, 20 + paddedJsonLength);
  output.set(jsonBytes, 20);
  const outputBinHeader = 20 + paddedJsonLength;
  outputView.setUint32(outputBinHeader, rebuiltBinLength, true);
  outputView.setUint32(outputBinHeader + 4, BIN_CHUNK, true);
  const outputBinStart = outputBinHeader + 8;
  for (let index = 0; index < rewrittenData.length; index += 1) {
    output.set(rewrittenData[index], outputBinStart + (bufferViews[index].byteOffset ?? 0));
  }
  return output.buffer;
}
