import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

export interface UsdzConformanceAudit {
  schema: 'morphloom.usdz-conformance/0.1';
  status: 'pass' | 'blocked';
  files: number;
  bytes: number;
  repairedVarnameTypes: number;
  repairedTransformInputTypes: number;
  repairedNormalMaps: number;
  blockers: string[];
}

const MAX_USDZ_BYTES = 256 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 512 * 1024 * 1024;
const MAX_FILES = 20_000;

function preflightZip(payload: Uint8Array): void {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const minimumEocdOffset = Math.max(0, payload.byteLength - 65_557);
  let eocdOffset = -1;
  for (let offset = payload.byteLength - 22; offset >= minimumEocdOffset; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50
      && offset + 22 + view.getUint16(offset + 20, true) === payload.byteLength) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error('USDZ archive is missing a bounded ZIP central directory.');
  const filesOnDisk = view.getUint16(eocdOffset + 8, true);
  const totalFiles = view.getUint16(eocdOffset + 10, true);
  const centralSize = view.getUint32(eocdOffset + 12, true);
  const centralOffset = view.getUint32(eocdOffset + 16, true);
  if (view.getUint16(eocdOffset + 4, true) !== 0 || view.getUint16(eocdOffset + 6, true) !== 0
    || filesOnDisk !== totalFiles || totalFiles < 2 || totalFiles > MAX_FILES
    || centralSize === 0xffffffff || centralOffset === 0xffffffff
    || centralOffset + centralSize > eocdOffset) {
    throw new Error('USDZ archive central directory is outside the safe budget.');
  }
  let cursor = centralOffset;
  let unpackedBytes = 0;
  for (let index = 0; index < totalFiles; index += 1) {
    if (cursor + 46 > eocdOffset || view.getUint32(cursor, true) !== 0x02014b50) {
      throw new Error('USDZ archive central directory is malformed.');
    }
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    if (uncompressedSize === 0xffffffff) throw new Error('ZIP64 USDZ archives are outside the safe budget.');
    unpackedBytes += uncompressedSize;
    if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error('USDZ archive exceeds the 512 MB unpacked budget.');
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralSize) throw new Error('USDZ archive central directory length is inconsistent.');
}

function replaceCount(source: string, pattern: RegExp, replacement: string): { text: string; count: number } {
  let count = 0;
  return {
    text: source.replace(pattern, () => {
      count += 1;
      return replacement;
    }),
    get count() { return count; },
  };
}

function repairNormalTextureBlocks(source: string): { text: string; count: number } {
  let count = 0;
  const text = source.replace(
    /(def Shader "Texture_[^"]+_normal"\s*\n\s*\{)([\s\S]*?)(\n\s*\})/g,
    (block, opening: string, body: string, closing: string) => {
      if (body.includes('inputs:bias') || body.includes('inputs:scale = (2, 2, 2, 1)')) return block;
      const repairedBody = body.replace(
        /(\n\s*)uniform token info:id = "UsdUVTexture"/,
        '$1uniform token info:id = "UsdUVTexture"$1float4 inputs:scale = (2, 2, 2, 1)$1float4 inputs:bias = (-1, -1, -1, 0)',
      );
      if (repairedBody === body) return block;
      count += 1;
      return `${opening}${repairedBody}${closing}`;
    },
  );
  return { text, count };
}

function alignedStore(files: Record<string, Uint8Array>): Uint8Array {
  const packed: Record<string, Uint8Array | [Uint8Array, { extra: Record<number, Uint8Array> }]> = {};
  let offset = 0;
  for (const [filename, file] of Object.entries(files)) {
    const headerSize = 34 + filename.length;
    offset += headerSize;
    const offsetMod64 = offset & 63;
    packed[filename] = offsetMod64 === 4
      ? file
      : [file, { extra: { 12345: new Uint8Array(64 - offsetMod64) } }];
    offset = file.length;
  }
  return zipSync(packed, { level: 0 });
}

export function repairThreeUsdz(payload: Uint8Array): { bytes: Uint8Array; audit: UsdzConformanceAudit } {
  if (!(payload instanceof Uint8Array) || payload.byteLength < 32 || payload.byteLength > MAX_USDZ_BYTES) {
    throw new Error('USDZ payload is outside the 32 byte..256 MB budget.');
  }
  preflightZip(payload);
  const files = unzipSync(payload);
  const entries = Object.entries(files);
  if (entries.length < 2 || entries.length > MAX_FILES) throw new Error('USDZ archive file count is outside the safe budget.');
  let unpackedBytes = 0;
  for (const [name, bytes] of entries) {
    if (!name || name.length > 512 || /^(?:\/|[a-z]:[\\/])/i.test(name) || name.split(/[\\/]+/).includes('..')) {
      throw new Error('USDZ archive contains an unsafe file path.');
    }
    unpackedBytes += bytes.byteLength;
    if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error('USDZ archive exceeds the 512 MB unpacked budget.');
  }
  const model = files['model.usda'];
  if (!model || model.byteLength < 32 || model.byteLength > 64 * 1024 * 1024) {
    throw new Error('USDZ archive is missing a bounded model.usda root layer.');
  }
  const decoded = strFromU8(model);
  const varname = replaceCount(decoded, /\btoken inputs:varname =/g, 'string inputs:varname =');
  const transformInput = replaceCount(varname.text, /\btoken inputs:in\.connect =/g, 'float2 inputs:in.connect =');
  const normalMaps = repairNormalTextureBlocks(transformInput.text);
  files['model.usda'] = strToU8(normalMaps.text);
  const blockers: string[] = [];
  if (/\btoken inputs:varname =/.test(normalMaps.text)) blockers.push('UsdPrimvarReader varname type remains token instead of string');
  if (/\btoken inputs:in\.connect =/.test(normalMaps.text)) blockers.push('UsdTransform2d input type remains token instead of float2');
  const normalTextureBlocks = normalMaps.text.match(/def Shader "Texture_[^"]+_normal"/g)?.length ?? 0;
  const decodedNormalMaps = normalMaps.text.match(/float4 inputs:bias = \(-1, -1, -1, 0\)/g)?.length ?? 0;
  if (normalTextureBlocks !== decodedNormalMaps) blockers.push('one or more 8-bit normal maps lack USD scale/bias decoding');
  const bytes = alignedStore(files);
  if (bytes.byteLength > MAX_USDZ_BYTES) blockers.push('repaired USDZ exceeds the 256 MB delivery budget');
  const audit: UsdzConformanceAudit = {
    schema: 'morphloom.usdz-conformance/0.1',
    status: blockers.length === 0 ? 'pass' : 'blocked',
    files: entries.length,
    bytes: bytes.byteLength,
    repairedVarnameTypes: varname.count,
    repairedTransformInputTypes: transformInput.count,
    repairedNormalMaps: normalMaps.count,
    blockers,
  };
  return { bytes, audit };
}
