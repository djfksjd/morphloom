import { unzlibSync } from 'fflate';

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_BYTES = 32 * 1024 * 1024;
const MAX_PNG_PIXELS = 4_194_304;

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb8_8320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let value = 0xffff_ffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffff_ffff) >>> 0;
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function paeth(left: number, up: number, upperLeft: number): number {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const diagonalDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= diagonalDistance ? left : upDistance <= diagonalDistance ? up : upperLeft;
}

export function decodePng(bytes: Uint8Array): DecodedPng {
  if (bytes.length < 33 || bytes.length > MAX_PNG_BYTES) throw new Error('PNG byte length is outside the safe range.');
  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) throw new Error('PNG signature is invalid.');
  let offset = PNG_SIGNATURE.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = -1;
  let palette: Uint8Array | undefined;
  let transparency: Uint8Array | undefined;
  const idat: Uint8Array[] = [];
  let sawEnd = false;
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const chunkEnd = offset + 12 + length;
    if (length > MAX_PNG_BYTES || chunkEnd > bytes.length) throw new Error('PNG chunk length is invalid.');
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    const expectedCrc = readU32(bytes, offset + 8 + length);
    const crcInput = new Uint8Array(typeBytes.length + data.length);
    crcInput.set(typeBytes);
    crcInput.set(data, typeBytes.length);
    if (crc32(crcInput) !== expectedCrc) throw new Error(`PNG ${type} chunk CRC is invalid.`);
    if (type === 'IHDR') {
      if (length !== 13 || width !== 0) throw new Error('PNG IHDR is invalid or duplicated.');
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8]!;
      colorType = data[9]!;
      const compression = data[10]!;
      const filter = data[11]!;
      interlace = data[12]!;
      if (width < 2 || height < 2 || width * height > MAX_PNG_PIXELS) throw new Error('PNG dimensions exceed the safe pixel budget.');
      if (bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(colorType) || compression !== 0 || filter !== 0 || interlace !== 0) {
        throw new Error('Only non-interlaced 8-bit PNG colour modes are supported.');
      }
    } else if (type === 'PLTE') {
      if (length === 0 || length % 3 !== 0 || length > 768) throw new Error('PNG palette is invalid.');
      palette = new Uint8Array(data);
    } else if (type === 'tRNS') {
      transparency = new Uint8Array(data);
    } else if (type === 'IDAT') {
      idat.push(new Uint8Array(data));
    } else if (type === 'IEND') {
      sawEnd = true;
      break;
    }
    offset = chunkEnd;
  }
  if (!sawEnd || width === 0 || height === 0 || idat.length === 0) throw new Error('PNG is incomplete.');
  if (colorType === 3 && !palette) throw new Error('Indexed PNG is missing its palette.');
  if (transparency && colorType !== 3) {
    throw new Error('PNG tRNS is supported only for indexed colour; use RGBA for transparent grayscale or RGB input.');
  }
  const compressedLength = idat.reduce((sum, chunk) => sum + chunk.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let writeOffset = 0;
  for (const chunk of idat) {
    compressed.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  const bytesPerPixel = colorType === 0 || colorType === 3 ? 1 : colorType === 4 ? 2 : colorType === 2 ? 3 : 4;
  const stride = width * bytesPerPixel;
  const expectedInflated = (stride + 1) * height;
  // Supply a hard output ceiling so a small malicious zlib stream cannot
  // allocate beyond the dimensions already accepted from IHDR. The extra byte
  // makes overlong output observable instead of silently truncating it.
  const inflated = unzlibSync(compressed, { out: new Uint8Array(expectedInflated + 1) });
  if (inflated.length !== expectedInflated) throw new Error('PNG inflated data length is invalid.');
  const raw = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[y * (stride + 1)]!;
    if (filter > 4) throw new Error('PNG scanline filter is invalid.');
    for (let x = 0; x < stride; x += 1) {
      const encoded = inflated[y * (stride + 1) + x + 1]!;
      const left = x >= bytesPerPixel ? raw[y * stride + x - bytesPerPixel]! : 0;
      const up = y > 0 ? raw[(y - 1) * stride + x]! : 0;
      const upperLeft = y > 0 && x >= bytesPerPixel ? raw[(y - 1) * stride + x - bytesPerPixel]! : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : paeth(left, up, upperLeft);
      raw[y * stride + x] = (encoded + predictor) & 0xff;
    }
  }
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    const source = index * bytesPerPixel;
    const target = index * 4;
    if (colorType === 0) {
      rgba.set([raw[source]!, raw[source]!, raw[source]!, 255], target);
    } else if (colorType === 2) {
      rgba.set([raw[source]!, raw[source + 1]!, raw[source + 2]!, 255], target);
    } else if (colorType === 3) {
      const paletteIndex = raw[source]!;
      const paletteOffset = paletteIndex * 3;
      if (!palette || paletteOffset + 2 >= palette.length) throw new Error('PNG palette index is out of bounds.');
      rgba.set([palette[paletteOffset]!, palette[paletteOffset + 1]!, palette[paletteOffset + 2]!, transparency?.[paletteIndex] ?? 255], target);
    } else if (colorType === 4) {
      rgba.set([raw[source]!, raw[source]!, raw[source]!, raw[source + 1]!], target);
    } else {
      rgba.set([raw[source]!, raw[source + 1]!, raw[source + 2]!, raw[source + 3]!], target);
    }
  }
  return { width, height, rgba };
}
