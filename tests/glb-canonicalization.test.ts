import { describe, expect, it } from 'vitest';
import { canonicalizeGlbBufferViews } from '../src/engine/glb-canonicalization';

const align4 = (value: number) => (value + 3) & ~3;

function makeImageOrderFixture(swapped: boolean): ArrayBuffer {
  const geometry = new Uint8Array([9, 8, 7, 6]);
  const firstImage = new Uint8Array([1, 2, 3]);
  const secondImage = new Uint8Array([4, 5, 6, 7, 8]);
  const viewData = swapped ? [geometry, secondImage, firstImage] : [geometry, firstImage, secondImage];
  let offset = 0;
  const bufferViews = viewData.map((data) => {
    const result = { buffer: 0, byteOffset: offset, byteLength: data.byteLength };
    offset = align4(offset + data.byteLength);
    return result;
  });
  const json = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: offset }],
    bufferViews,
    images: [
      { mimeType: 'image/png', bufferView: swapped ? 2 : 1 },
      { mimeType: 'image/png', bufferView: swapped ? 1 : 2 },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = align4(jsonBytes.byteLength);
  const output = new Uint8Array(12 + 8 + jsonLength + 8 + offset);
  const view = new DataView(output.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, output.byteLength, true);
  view.setUint32(12, jsonLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  output.fill(0x20, 20, 20 + jsonLength);
  output.set(jsonBytes, 20);
  const binHeader = 20 + jsonLength;
  view.setUint32(binHeader, offset, true);
  view.setUint32(binHeader + 4, 0x004e4942, true);
  for (let index = 0; index < viewData.length; index += 1) {
    output.set(viewData[index], binHeader + 8 + bufferViews[index].byteOffset);
  }
  return output.buffer;
}

describe('GLB canonicalization', () => {
  it('makes concurrent image buffer-view completion order byte deterministic', () => {
    const first = canonicalizeGlbBufferViews(makeImageOrderFixture(false));
    const second = canonicalizeGlbBufferViews(makeImageOrderFixture(true));
    expect(new Uint8Array(first)).toEqual(new Uint8Array(second));
    expect(new Uint8Array(canonicalizeGlbBufferViews(first))).toEqual(new Uint8Array(first));
  });

  it('rejects a malformed GLB instead of rewriting unchecked bytes', () => {
    expect(() => canonicalizeGlbBufferViews(new ArrayBuffer(40))).toThrow('invalid header');
  });
});
