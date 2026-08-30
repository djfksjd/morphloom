import type { HumanPack, MorphTarget, OhpkManifest } from '../types';

const OHPK_HEADER_SIZE = 10;
const textDecoder = new TextDecoder();

type InflateRaw = (payload: Uint8Array) => Promise<Uint8Array>;

class BinaryReader {
  private readonly view: DataView;
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  private ensure(length: number): void {
    if (this.offset + length > this.bytes.byteLength) {
      throw new Error(`OHPK data ended at byte ${this.offset}; ${length} more bytes were required.`);
    }
  }

  u8(): number {
    this.ensure(1);
    return this.view.getUint8(this.offset++);
  }

  u16(): number {
    this.ensure(2);
    const value = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return value;
  }

  i16(): number {
    this.ensure(2);
    const value = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return value;
  }

  u32(): number {
    this.ensure(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f32(): number {
    this.ensure(4);
    const value = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return value;
  }

  slice(length: number): Uint8Array {
    this.ensure(length);
    const value = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  stringU16(): string {
    return textDecoder.decode(this.slice(this.u16()));
  }

  varUint(): number {
    let value = 0;
    let shift = 0;
    while (shift < 35) {
      const byte = this.u8();
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
    }
    throw new Error('OHPK target index uses an invalid varint.');
  }
}

async function browserInflateRaw(payload: Uint8Array): Promise<Uint8Array> {
  if (!('DecompressionStream' in window)) {
    throw new Error('This browser does not support local DEFLATE decoding.');
  }
  const stream = new Blob([payload as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function loadHumanPack(url: string): Promise<HumanPack> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Human pack download failed with ${response.status}.`);
  return parseOhpk(new Uint8Array(await response.arrayBuffer()), browserInflateRaw);
}

export async function parseOhpk(bytes: Uint8Array, inflateRaw: InflateRaw): Promise<HumanPack> {
  if (bytes.byteLength < OHPK_HEADER_SIZE) throw new Error('OHPK header is incomplete.');
  if (textDecoder.decode(bytes.subarray(0, 4)) !== 'OHPK') throw new Error('Not an OHPK file.');
  if (bytes[4] !== 1) throw new Error(`OHPK version ${bytes[4]} is not supported.`);

  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[5];
  const expectedBodySize = header.getUint32(6, true);
  const payload = bytes.subarray(OHPK_HEADER_SIZE);
  const body = (flags & 1) === 1 ? await inflateRaw(payload) : payload;
  if (body.byteLength !== expectedBodySize) {
    throw new Error(`OHPK body is ${body.byteLength} bytes; expected ${expectedBodySize}.`);
  }

  const reader = new BinaryReader(body);
  const manifest = JSON.parse(textDecoder.decode(reader.slice(reader.u32()))) as OhpkManifest;
  const vertexCount = reader.u32();
  const indexCount = reader.u32();

  if (vertexCount < 3 || vertexCount > 2_000_000) throw new Error('OHPK vertex count is unsafe.');
  if (indexCount < 3 || indexCount > 12_000_000) throw new Error('OHPK index count is unsafe.');

  const positionScale = [reader.f32(), reader.f32(), reader.f32()];
  const positionBias = [reader.f32(), reader.f32(), reader.f32()];
  const quantizationError = reader.f32();
  const positions = new Float32Array(vertexCount * 3);
  for (let i = 0; i < positions.length; i += 1) {
    const axis = i % 3;
    positions[i] = reader.i16() * positionScale[axis] + positionBias[axis];
  }

  const indices = new Uint32Array(indexCount);
  for (let i = 0; i < indices.length; i += 1) indices[i] = reader.u32();

  let uvs: Float32Array | undefined;
  if (reader.u8() !== 0) {
    const uvScale = [reader.f32(), reader.f32()];
    const uvBias = [reader.f32(), reader.f32()];
    reader.f32();
    uvs = new Float32Array(vertexCount * 2);
    for (let i = 0; i < uvs.length; i += 1) {
      const axis = i % 2;
      uvs[i] = reader.i16() * uvScale[axis] + uvBias[axis];
    }
  }

  let helperMetadata: Uint8Array | undefined;
  if (reader.u8() !== 0) helperMetadata = reader.slice(reader.u32()).slice();

  const targetCount = reader.u32();
  if (targetCount > 10_000) throw new Error('OHPK target count is unsafe.');
  const targets: MorphTarget[] = [];
  for (let targetIndex = 0; targetIndex < targetCount; targetIndex += 1) {
    const name = reader.stringU16();
    const category = reader.stringU16();
    const scale = reader.f32();
    const targetError = reader.f32();
    const affectedCount = reader.u32();
    if (affectedCount > vertexCount) throw new Error(`Morph target ${name} exceeds the mesh.`);

    const targetIndices = new Uint32Array(affectedCount);
    let previous = 0;
    for (let i = 0; i < affectedCount; i += 1) {
      previous += reader.varUint();
      if (previous >= vertexCount) throw new Error(`Morph target ${name} has an invalid vertex.`);
      targetIndices[i] = previous;
    }

    const deltas = new Int16Array(affectedCount * 3);
    for (let i = 0; i < deltas.length; i += 1) deltas[i] = reader.i16();
    targets.push({
      name,
      category,
      scale,
      quantizationError: targetError,
      indices: targetIndices,
      deltas,
    });
  }

  return {
    manifest,
    positions,
    indices,
    uvs,
    helperMetadata,
    targets,
    quantizationError,
  };
}
