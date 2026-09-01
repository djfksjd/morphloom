import { createCanvas, loadImage } from '@napi-rs/canvas';
import { decodePng } from './png-decoder';

const MAX_IMAGE_BYTES = 32 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 4_194_304;

export interface DecodedReferenceImage {
  format: 'png' | 'jpeg' | 'webp';
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

function assertByteBudget(bytes: Uint8Array): void {
  if (bytes.length < 12 || bytes.length > MAX_IMAGE_BYTES) {
    throw new Error('Reference image byte length is outside the safe range.');
  }
}

function assertDimensions(width: number, height: number, format: string): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || !Number.isSafeInteger(width * height) || width * height > MAX_IMAGE_PIXELS) {
    throw new Error(`${format} dimensions exceed the safe pixel budget.`);
  }
}

function jpegDimensions(bytes: Uint8Array): [number, number] {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) throw new Error('JPEG signature is invalid.');
  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset + 3 < bytes.length) {
    while (offset < bytes.length && bytes[offset] !== 0xff) offset += 1;
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++]!;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= bytes.length) break;
    const segmentLength = (bytes[offset]! << 8) | bytes[offset + 1]!;
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw new Error('JPEG segment length is invalid.');
    if (frameMarkers.has(marker)) {
      if (segmentLength < 7) throw new Error('JPEG frame header is incomplete.');
      const height = (bytes[offset + 3]! << 8) | bytes[offset + 4]!;
      const width = (bytes[offset + 5]! << 8) | bytes[offset + 6]!;
      return [width, height];
    }
    offset += segmentLength;
  }
  throw new Error('JPEG dimensions are unavailable before image decoding.');
}

function littleU32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function webpDimensions(bytes: Uint8Array): [number, number] {
  const ascii = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WEBP') throw new Error('WebP signature is invalid.');
  const declaredLength = littleU32(bytes, 4) + 8;
  if (declaredLength > bytes.length || declaredLength < 20) throw new Error('WebP RIFF length is invalid.');
  let offset = 12;
  while (offset + 8 <= declaredLength) {
    const type = ascii(offset, 4);
    const length = littleU32(bytes, offset + 4);
    const data = offset + 8;
    const end = data + length;
    if (end > declaredLength) throw new Error('WebP chunk length is invalid.');
    if (type === 'VP8X') {
      if (length < 10) throw new Error('WebP VP8X header is incomplete.');
      const width = 1 + bytes[data + 4]! + (bytes[data + 5]! << 8) + (bytes[data + 6]! << 16);
      const height = 1 + bytes[data + 7]! + (bytes[data + 8]! << 8) + (bytes[data + 9]! << 16);
      return [width, height];
    }
    if (type === 'VP8L') {
      if (length < 5 || bytes[data] !== 0x2f) throw new Error('WebP VP8L header is invalid.');
      const bits = littleU32(bytes, data + 1);
      return [(bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1];
    }
    if (type === 'VP8 ') {
      if (length < 10 || bytes[data + 3] !== 0x9d || bytes[data + 4] !== 0x01 || bytes[data + 5] !== 0x2a) {
        throw new Error('WebP VP8 frame header is invalid.');
      }
      const width = (bytes[data + 6]! | (bytes[data + 7]! << 8)) & 0x3fff;
      const height = (bytes[data + 8]! | (bytes[data + 9]! << 8)) & 0x3fff;
      return [width, height];
    }
    offset = end + (length & 1);
  }
  throw new Error('WebP dimensions are unavailable before image decoding.');
}

function detectedFormat(bytes: Uint8Array): DecodedReferenceImage['format'] {
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP') return 'webp';
  throw new Error('Reference image must be PNG, JPEG, or WebP.');
}

export async function decodeReferenceImage(bytes: Uint8Array): Promise<DecodedReferenceImage> {
  assertByteBudget(bytes);
  const format = detectedFormat(bytes);
  if (format === 'png') return { format, ...decodePng(bytes) };
  const [expectedWidth, expectedHeight] = format === 'jpeg' ? jpegDimensions(bytes) : webpDimensions(bytes);
  assertDimensions(expectedWidth, expectedHeight, format === 'jpeg' ? 'JPEG' : 'WebP');
  const image = await loadImage(bytes);
  if (image.width !== expectedWidth || image.height !== expectedHeight) {
    throw new Error('Decoded reference dimensions do not match the bounded image header.');
  }
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0);
  return {
    format,
    width: image.width,
    height: image.height,
    rgba: context.getImageData(0, 0, image.width, image.height).data,
  };
}
