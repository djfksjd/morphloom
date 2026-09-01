import { createCanvas } from '@napi-rs/canvas';
import { describe, expect, it } from 'vitest';
import { decodeReferenceImage } from '../scripts/lib/reference-image-decoder';

function fixture(mime: 'image/png' | 'image/jpeg' | 'image/webp'): Uint8Array {
  const canvas = createCanvas(8, 6);
  const context = canvas.getContext('2d');
  context.fillStyle = '#20242a';
  context.fillRect(0, 0, 8, 6);
  context.fillStyle = '#d45b43';
  context.fillRect(1, 1, 4, 3);
  return new Uint8Array(canvas.toBuffer(mime, 90));
}

describe('bounded reference image ingestion', () => {
  it.each([
    ['image/png', 'png'],
    ['image/jpeg', 'jpeg'],
    ['image/webp', 'webp'],
  ] as const)('decodes %s into a shared RGBA surface input', async (mime, format) => {
    const decoded = await decodeReferenceImage(fixture(mime));
    expect(decoded).toMatchObject({ format, width: 8, height: 6 });
    expect(decoded.rgba).toHaveLength(8 * 6 * 4);
    expect(decoded.rgba.some((value) => value > 0)).toBe(true);
  });

  it('rejects a WebP decompression bomb from its header before pixel allocation', async () => {
    const bytes = new Uint8Array(30);
    bytes.set(new TextEncoder().encode('RIFF'), 0);
    new DataView(bytes.buffer).setUint32(4, 22, true);
    bytes.set(new TextEncoder().encode('WEBPVP8X'), 8);
    new DataView(bytes.buffer).setUint32(16, 10, true);
    const dimensionMinusOne = 9_999;
    bytes[24] = dimensionMinusOne & 0xff;
    bytes[25] = (dimensionMinusOne >>> 8) & 0xff;
    bytes[26] = (dimensionMinusOne >>> 16) & 0xff;
    bytes[27] = dimensionMinusOne & 0xff;
    bytes[28] = (dimensionMinusOne >>> 8) & 0xff;
    bytes[29] = (dimensionMinusOne >>> 16) & 0xff;
    await expect(decodeReferenceImage(bytes)).rejects.toThrow(/pixel budget/);
  });

  it('rejects unsupported and truncated image data', async () => {
    await expect(decodeReferenceImage(new Uint8Array(64).fill(0x41))).rejects.toThrow(/PNG, JPEG, or WebP/);
    await expect(decodeReferenceImage(new Uint8Array([0xff, 0xd8, 0xff]))).rejects.toThrow(/safe range/);
  });
});
