import * as THREE from 'three';
import type { AssemblyGeometryIR } from './assembly-ir';
import { sampleQuantizedReferenceHeight } from './reference-surface';

type SurfacePatchIR = Extract<AssemblyGeometryIR, { op: 'surfacePatch' }>;

export interface SurfaceReliefAudit {
  method: 'deterministic-angular-aggregate-height-field-v2'
    | 'reference-conditioned-aggregate-height-field-v3'
    | 'reference-conditioned-multiscale-aggregate-height-field-v4';
  seed: number;
  samples: number;
  minimumMm: number;
  maximumMm: number;
  meanMm: number;
  rmsRoughnessMm: number;
  peakToValleyMm: number;
  macroAmplitudeMm: number;
  aggregateAmplitudeMm: number;
  aggregateScaleMm: number;
  aggregateFeatures: number;
  coarseAggregateFeatures: number;
  fineAggregateFeatures: number;
  facetedNormals: true;
  referenceFingerprint?: string;
  referenceSamples?: number;
  referenceBlend?: number;
  referenceIrregularity?: number;
}

function latticeHash(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374_761_393) ^ Math.imul(z, 668_265_263) ^ Math.imul(seed, 1_443_051);
  value = Math.imul(value ^ (value >>> 13), 1_274_126_177);
  return ((value ^ (value >>> 16)) >>> 0) / 0xffff_ffff;
}

function fade(value: number): number {
  return value * value * (3 - 2 * value);
}

function valueNoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const tx = fade(x - ix);
  const tz = fade(z - iz);
  const a = THREE.MathUtils.lerp(latticeHash(ix, iz, seed), latticeHash(ix + 1, iz, seed), tx);
  const b = THREE.MathUtils.lerp(latticeHash(ix, iz + 1, seed), latticeHash(ix + 1, iz + 1, seed), tx);
  return THREE.MathUtils.lerp(a, b, tz) * 2 - 1;
}

function fractalNoise(x: number, z: number, seed: number): number {
  let sum = 0;
  let amplitude = 0.58;
  let normalizer = 0;
  for (let octave = 0; octave < 4; octave += 1) {
    sum += valueNoise(x, z, seed + octave * 97) * amplitude;
    normalizer += amplitude;
    x *= 2.03;
    z *= 1.97;
    amplitude *= 0.48;
  }
  return sum / normalizer;
}

function aggregateCell(
  cellX: number,
  cellZ: number,
  spec: SurfacePatchIR,
  scale: number,
  seedOffset: number,
): {
  xMm: number;
  zMm: number;
  radiusMm: number;
  height: number;
  angle: number;
  aspect: number;
  sides: number;
  phase: number;
} | undefined {
  if (latticeHash(cellX, cellZ, spec.seed + seedOffset + 1_213) < 0.1) return undefined;
  return {
    xMm: (cellX + 0.12 + latticeHash(cellX, cellZ, spec.seed + seedOffset + 1_307) * 0.76) * scale,
    zMm: (cellZ + 0.12 + latticeHash(cellX, cellZ, spec.seed + seedOffset + 1_409) * 0.76) * scale,
    radiusMm: scale * (0.42 + latticeHash(cellX, cellZ, spec.seed + seedOffset + 1_511) * 0.2),
    height: 0.62 + latticeHash(cellX, cellZ, spec.seed + seedOffset + 1_613) * 0.38,
    angle: latticeHash(cellX, cellZ, spec.seed + seedOffset + 1_717) * Math.PI,
    aspect: 0.64 + latticeHash(cellX, cellZ, spec.seed + seedOffset + 1_811) * 0.34,
    sides: 4 + Math.floor(latticeHash(cellX, cellZ, spec.seed + seedOffset + 1_919) * 4),
    phase: latticeHash(cellX, cellZ, spec.seed + seedOffset + 2_021) * Math.PI * 2,
  };
}

function aggregateLayer(
  xMm: number,
  zMm: number,
  spec: SurfacePatchIR,
  scale: number,
  seedOffset: number,
): number {
  const warpedX = xMm + fractalNoise(xMm / (scale * 5.1), zMm / (scale * 5.1), spec.seed + seedOffset + 4_001) * scale * 0.72;
  const warpedZ = zMm + fractalNoise(xMm / (scale * 4.7), zMm / (scale * 4.7), spec.seed + seedOffset + 4_409) * scale * 0.72;
  const cellX = Math.floor(warpedX / scale);
  const cellZ = Math.floor(warpedZ / scale);
  let strongestStone = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      const stone = aggregateCell(cellX + dx, cellZ + dz, spec, scale, seedOffset);
      if (!stone) continue;
      const cos = Math.cos(stone.angle);
      const sin = Math.sin(stone.angle);
      const deltaX = warpedX - stone.xMm;
      const deltaZ = warpedZ - stone.zMm;
      const localX = deltaX * cos - deltaZ * sin;
      const localZ = (deltaX * sin + deltaZ * cos) / stone.aspect;
      const polarAngle = Math.atan2(localZ, localX);
      // Crushed aggregate has angular, irregular outlines rather than round pebble silhouettes.
      const polygonRadius = stone.radiusMm * (
        0.86
        + Math.cos(polarAngle * stone.sides + stone.phase) * 0.1
        + Math.cos(polarAngle * (stone.sides - 1) - stone.phase * 0.7) * 0.04
      );
      const normalizedDistance = Math.hypot(localX, localZ) / polygonRadius;
      if (normalizedDistance >= 1) continue;
      // A finite rim height keeps visible binder joints between adjacent stones;
      // the linear centre term produces planar facets instead of smooth bubbles.
      const shoulder = 0.22 + (1 - normalizedDistance) * 0.78;
      const facet = 0.82
        + 0.13 * Math.abs(Math.cos(polarAngle * stone.sides * 0.5 + stone.phase))
        + 0.05 * valueNoise(localX / Math.max(scale * 0.22, 0.1), localZ / Math.max(scale * 0.22, 0.1), spec.seed + seedOffset + 2_117);
      strongestStone = Math.max(strongestStone, shoulder * facet * stone.height);
    }
  }
  return strongestStone;
}

function aggregateRelief(xMm: number, zMm: number, spec: SurfacePatchIR): number {
  const scale = spec.aggregateScale;
  const coarse = aggregateLayer(xMm, zMm, spec, scale, 0);
  const fine = aggregateLayer(xMm, zMm, spec, scale * 0.43, 8_311);
  const binderGrain = valueNoise(
    xMm / Math.max(scale * 0.17, 0.1),
    zMm / Math.max(scale * 0.17, 0.1),
    spec.seed + 1_907,
  );
  // Coarse stones establish the silhouette, fine stones fill binder gaps, and
  // the negative baseline preserves the dark troughs visible at grazing angles.
  const packedAggregate = Math.max(coarse, fine * 0.62);
  return (packedAggregate - 0.34 + binderGrain * 0.075) * spec.aggregateAmplitude;
}

function aggregateFeatureCount(spec: SurfacePatchIR, scale: number, seedOffset: number): number {
  const halfWidth = spec.size[0] * 0.5;
  const halfDepth = spec.size[1] * 0.5;
  const minX = Math.floor(-halfWidth / scale) - 1;
  const maxX = Math.ceil(halfWidth / scale) + 1;
  const minZ = Math.floor(-halfDepth / scale) - 1;
  const maxZ = Math.ceil(halfDepth / scale) + 1;
  let count = 0;
  for (let z = minZ; z <= maxZ; z += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const stone = aggregateCell(x, z, spec, scale, seedOffset);
      if (stone && stone.xMm >= -halfWidth && stone.xMm <= halfWidth
        && stone.zMm >= -halfDepth && stone.zMm <= halfDepth) count += 1;
    }
  }
  return count;
}

function elevationMm(xMm: number, zMm: number, u: number, v: number, spec: SurfacePatchIR): number {
  const aggregateScale = spec.aggregateScale;
  const macroScale = Math.max(aggregateScale * 10, Math.min(spec.size[0], spec.size[1]) * 0.18);
  const macro = fractalNoise(xMm / macroScale, zMm / macroScale, spec.seed) * spec.macroAmplitude;
  const aggregate = aggregateRelief(xMm, zMm, spec);
  if (!spec.referenceRelief) return macro + aggregate;
  const blend = spec.referenceRelief.blend;
  const reference = sampleQuantizedReferenceHeight(spec.referenceRelief, u, v);
  return macro * (1 - blend * 0.45) + aggregate * (1 - blend) + reference;
}

/** Builds a closed, UV-mapped slab whose top surface carries real multi-scale displacement. */
export function createLayeredSurfaceGeometry(spec: SurfacePatchIR): THREE.BufferGeometry {
  const [segmentsX, segmentsZ] = spec.segments;
  const columns = segmentsX + 1;
  const rows = segmentsZ + 1;
  const layerVertices = columns * rows;
  const positions = new Float32Array(layerVertices * 2 * 3);
  const uvs = new Float32Array(layerVertices * 2 * 2);
  const elevations: number[] = [];
  const halfWidthMm = spec.size[0] * 0.5;
  const halfDepthMm = spec.size[1] * 0.5;
  const baseTopMm = spec.baseThickness * 0.5;
  const bottomMm = -baseTopMm;

  for (let row = 0; row < rows; row += 1) {
    const v = row / segmentsZ;
    const zMm = THREE.MathUtils.lerp(-halfDepthMm, halfDepthMm, v);
    for (let column = 0; column < columns; column += 1) {
      const u = column / segmentsX;
      const xMm = THREE.MathUtils.lerp(-halfWidthMm, halfWidthMm, u);
      const elevation = elevationMm(xMm, zMm, u, v, spec);
      elevations.push(elevation);
      const top = row * columns + column;
      const bottom = layerVertices + top;
      positions.set([xMm / 1000, (baseTopMm + elevation) / 1000, zMm / 1000], top * 3);
      positions.set([xMm / 1000, bottomMm / 1000, zMm / 1000], bottom * 3);
      uvs.set([u, v], top * 2);
      uvs.set([u, v], bottom * 2);
    }
  }

  const topIndices: number[] = [];
  const baseIndices: number[] = [];
  for (let row = 0; row < segmentsZ; row += 1) {
    for (let column = 0; column < segmentsX; column += 1) {
      const a = row * columns + column;
      const b = a + 1;
      const c = a + columns;
      const d = c + 1;
      topIndices.push(a, d, b, a, c, d);
      const ba = layerVertices + a;
      const bb = layerVertices + b;
      const bc = layerVertices + c;
      const bd = layerVertices + d;
      baseIndices.push(ba, bb, bd, ba, bd, bc);
    }
  }

  const indices = [...topIndices, ...baseIndices];

  const sideQuad = (topA: number, topB: number, reverse = false) => {
    const bottomA = layerVertices + topA;
    const bottomB = layerVertices + topB;
    if (reverse) indices.push(topA, bottomA, bottomB, topA, bottomB, topB);
    else indices.push(topA, topB, bottomB, topA, bottomB, bottomA);
  };
  for (let column = 0; column < segmentsX; column += 1) {
    sideQuad(column, column + 1);
    const rear = segmentsZ * columns + column;
    sideQuad(rear, rear + 1, true);
  }
  for (let row = 0; row < segmentsZ; row += 1) {
    sideQuad(row * columns, (row + 1) * columns, true);
    sideQuad(row * columns + segmentsX, (row + 1) * columns + segmentsX);
  }

  const mean = elevations.reduce((sum, value) => sum + value, 0) / elevations.length;
  const rms = Math.sqrt(elevations.reduce((sum, value) => sum + (value - mean) ** 2, 0) / elevations.length);
  const minimum = Math.min(...elevations);
  const maximum = Math.max(...elevations);
  const coarseAggregateFeatures = aggregateFeatureCount(spec, spec.aggregateScale, 0);
  const fineAggregateFeatures = aggregateFeatureCount(spec, spec.aggregateScale * 0.43, 8_311);
  const audit: SurfaceReliefAudit = {
    method: spec.referenceRelief
      ? spec.referenceRelief.method === 'image-multiscale-height-v2'
        ? 'reference-conditioned-multiscale-aggregate-height-field-v4'
        : 'reference-conditioned-aggregate-height-field-v3'
      : 'deterministic-angular-aggregate-height-field-v2',
    seed: spec.seed,
    samples: elevations.length,
    minimumMm: minimum,
    maximumMm: maximum,
    meanMm: mean,
    rmsRoughnessMm: rms,
    peakToValleyMm: maximum - minimum,
    macroAmplitudeMm: spec.macroAmplitude,
    aggregateAmplitudeMm: spec.aggregateAmplitude,
    aggregateScaleMm: spec.aggregateScale,
    aggregateFeatures: coarseAggregateFeatures + fineAggregateFeatures,
    coarseAggregateFeatures,
    fineAggregateFeatures,
    facetedNormals: true,
    referenceFingerprint: spec.referenceRelief?.fingerprint,
    referenceSamples: spec.referenceRelief?.samples.length,
    referenceBlend: spec.referenceRelief?.blend,
    referenceIrregularity: spec.referenceRelief?.irregularity,
  };
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(0, topIndices.length, 0);
  geometry.addGroup(topIndices.length, indices.length - topIndices.length, 1);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.morphloomSurfaceRelief = audit;
  // Duplicate triangle vertices before computing normals so the broken-stone
  // facets survive glTF export; `flatShading` alone is only a viewer hint.
  const faceted = geometry.toNonIndexed();
  faceted.userData = { ...geometry.userData };
  faceted.computeVertexNormals();
  faceted.computeBoundingBox();
  faceted.computeBoundingSphere();
  geometry.dispose();
  return faceted;
}
