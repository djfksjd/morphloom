/**
 * Bounded pixel comparison with foreground-normalized interior bands.
 * The banded area-mean method is adapted from img2threejs.
 * Copyright 2026 hoainho. Licensed under Apache-2.0.
 * Source: https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage4_review/interior_difference.py
 * Modified for Morphloom: in-memory RGBA frames, named multi-band evidence,
 * explicit no-overlap refusal, and caller-controlled bounded grid resolution.
 */
export interface ComparisonFrame {
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
  /** Optional binary foreground mask. Non-zero values are treated as foreground. */
  mask?: Uint8Array;
  /** Used only when mask is absent. Defaults to white. */
  backgroundRgb?: [number, number, number];
}

export interface ComparisonRegion {
  featureId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RegionComparisonScore {
  featureId: string;
  silhouetteIoU: number;
  interiorSimilarity: number;
  score: number;
  foregroundPixels: { reference: number; render: number; intersection: number; union: number };
}

export interface ReferenceComparisonResult {
  method: 'pixel-frame-v1';
  referenceFingerprint: string;
  renderFingerprint: string;
  silhouetteIoU: number;
  interiorSimilarity: number;
  score: number;
  foregroundPixels: { reference: number; render: number; intersection: number; union: number };
  regions: RegionComparisonScore[];
}

export interface InteriorComparisonBand {
  id: string;
  from: number;
  to: number;
}

export interface InteriorBandScore {
  id: string;
  from: number;
  to: number;
  cellsCompared: number;
  interiorDifference: number | null;
  interiorSimilarity: number | null;
  status: 'measured' | 'no-overlapping-foreground-cells';
}

export interface BandedInteriorComparisonResult {
  method: 'foreground-normalized-bands-v1';
  grid: number;
  bands: InteriorBandScore[];
  aggregateSimilarity: number | null;
  cellsCompared: number;
}

const MAX_PIXELS = 16_777_216;

function validateFrame(frame: ComparisonFrame, label: string): void {
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1) {
    throw new Error(`${label} dimensions are invalid.`);
  }
  const pixels = frame.width * frame.height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_PIXELS) throw new Error(`${label} exceeds the comparison pixel budget.`);
  if (!(frame.rgba instanceof Uint8Array) && !(frame.rgba instanceof Uint8ClampedArray)) throw new Error(`${label} RGBA payload is invalid.`);
  if (frame.rgba.length !== pixels * 4) throw new Error(`${label} RGBA payload is invalid.`);
  if (frame.mask !== undefined && (!(frame.mask instanceof Uint8Array) || frame.mask.length !== pixels)) {
    throw new Error(`${label} foreground mask is invalid.`);
  }
  if (frame.backgroundRgb?.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) {
    throw new Error(`${label} background colour is invalid.`);
  }
}

function fingerprint(frame: ComparisonFrame): string {
  let hash = 0x811c9dc5;
  const mix = (value: number) => {
    hash ^= value;
    hash = Math.imul(hash, 0x01000193);
  };
  mix(frame.width & 0xff);
  mix((frame.width >>> 8) & 0xff);
  mix(frame.height & 0xff);
  mix((frame.height >>> 8) & 0xff);
  for (const value of frame.rgba) mix(value);
  if (frame.mask) for (const value of frame.mask) mix(value);
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function foreground(frame: ComparisonFrame, pixel: number): boolean {
  if (frame.mask) return frame.mask[pixel] !== 0;
  const offset = pixel * 4;
  if (frame.rgba[offset + 3] <= 16) return false;
  const background = frame.backgroundRgb ?? [255, 255, 255];
  const distance = Math.abs(frame.rgba[offset] - background[0])
    + Math.abs(frame.rgba[offset + 1] - background[1])
    + Math.abs(frame.rgba[offset + 2] - background[2]);
  return distance > 36;
}

function compareRange(reference: ComparisonFrame, render: ComparisonFrame, x0: number, y0: number, x1: number, y1: number) {
  let referencePixels = 0;
  let renderPixels = 0;
  let intersection = 0;
  let union = 0;
  let channelDifference = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const pixel = y * reference.width + x;
      const referenceForeground = foreground(reference, pixel);
      const renderForeground = foreground(render, pixel);
      if (referenceForeground) referencePixels += 1;
      if (renderForeground) renderPixels += 1;
      if (referenceForeground || renderForeground) union += 1;
      if (!referenceForeground || !renderForeground) continue;
      intersection += 1;
      const offset = pixel * 4;
      channelDifference += Math.abs(reference.rgba[offset] - render.rgba[offset]);
      channelDifference += Math.abs(reference.rgba[offset + 1] - render.rgba[offset + 1]);
      channelDifference += Math.abs(reference.rgba[offset + 2] - render.rgba[offset + 2]);
    }
  }
  const silhouetteIoU = union === 0 ? 1 : intersection / union;
  const interiorSimilarity = intersection === 0 ? (union === 0 ? 1 : 0) : 1 - channelDifference / (intersection * 3 * 255);
  return {
    silhouetteIoU,
    interiorSimilarity,
    score: silhouetteIoU * 0.65 + interiorSimilarity * 0.35,
    referencePixels,
    renderPixels,
    intersection,
    union,
  };
}

export function compareReferenceFrames(
  reference: ComparisonFrame,
  render: ComparisonFrame,
  regions: ComparisonRegion[] = [],
): ReferenceComparisonResult {
  validateFrame(reference, 'Reference frame');
  validateFrame(render, 'Render frame');
  if (reference.width !== render.width || reference.height !== render.height) throw new Error('Comparison frames must have identical dimensions.');
  if (!Array.isArray(regions) || regions.length > 512) throw new Error('Comparison region count is unsafe.');
  const ids = new Set<string>();
  for (const region of regions) {
    if (!/^[a-zA-Z0-9_-]{1,96}$/.test(region.featureId) || ids.has(region.featureId)
      || ![region.x, region.y, region.width, region.height].every(Number.isInteger)
      || region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1
      || region.x + region.width > reference.width || region.y + region.height > reference.height) {
      throw new Error(`Comparison region is invalid: ${region.featureId}`);
    }
    ids.add(region.featureId);
  }
  const total = compareRange(reference, render, 0, 0, reference.width, reference.height);
  return {
    method: 'pixel-frame-v1',
    referenceFingerprint: fingerprint(reference),
    renderFingerprint: fingerprint(render),
    silhouetteIoU: total.silhouetteIoU,
    interiorSimilarity: total.interiorSimilarity,
    score: total.score,
    foregroundPixels: {
      reference: total.referencePixels,
      render: total.renderPixels,
      intersection: total.intersection,
      union: total.union,
    },
    regions: regions.map((region) => {
      const score = compareRange(reference, render, region.x, region.y, region.x + region.width, region.y + region.height);
      return {
        featureId: region.featureId,
        silhouetteIoU: score.silhouetteIoU,
        interiorSimilarity: score.interiorSimilarity,
        score: score.score,
        foregroundPixels: {
          reference: score.referencePixels,
          render: score.renderPixels,
          intersection: score.intersection,
          union: score.union,
        },
      };
    }),
  };
}

function foregroundBounds(frame: ComparisonFrame): [number, number, number, number] | null {
  let minX = frame.width;
  let minY = frame.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < frame.height; y += 1) {
    for (let x = 0; x < frame.width; x += 1) {
      if (!foreground(frame, y * frame.width + x)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return maxX < 0 ? null : [minX, minY, maxX + 1, maxY + 1];
}

function sampleNormalizedInterior(frame: ComparisonFrame, grid: number): { luma: Float32Array; solid: Uint8Array } | null {
  const bounds = foregroundBounds(frame);
  if (!bounds) return null;
  const [x0, y0, x1, y1] = bounds;
  const boxWidth = Math.max(1, x1 - x0);
  const boxHeight = Math.max(1, y1 - y0);
  const luma = new Float32Array(grid * grid);
  const solid = new Uint8Array(grid * grid);
  for (let gy = 0; gy < grid; gy += 1) {
    const startY = y0 + Math.floor(gy * boxHeight / grid);
    const endY = Math.max(startY + 1, y0 + Math.floor((gy + 1) * boxHeight / grid));
    for (let gx = 0; gx < grid; gx += 1) {
      const startX = x0 + Math.floor(gx * boxWidth / grid);
      const endX = Math.max(startX + 1, x0 + Math.floor((gx + 1) * boxWidth / grid));
      let luminanceSum = 0;
      let counted = 0;
      let foregroundCount = 0;
      for (let y = startY; y < Math.min(endY, frame.height); y += 1) {
        for (let x = startX; x < Math.min(endX, frame.width); x += 1) {
          const pixel = y * frame.width + x;
          const offset = pixel * 4;
          luminanceSum += (frame.rgba[offset] * 0.2126 + frame.rgba[offset + 1] * 0.7152 + frame.rgba[offset + 2] * 0.0722) / 255;
          foregroundCount += Number(foreground(frame, pixel));
          counted += 1;
        }
      }
      const target = gy * grid + gx;
      luma[target] = counted === 0 ? 0 : luminanceSum / counted;
      solid[target] = counted > 0 && foregroundCount > counted / 2 ? 1 : 0;
    }
  }
  return { luma, solid };
}

export function compareInteriorBands(
  reference: ComparisonFrame,
  render: ComparisonFrame,
  bands: InteriorComparisonBand[] = [
    { id: 'top', from: 0, to: 1 / 3 },
    { id: 'middle', from: 1 / 3, to: 2 / 3 },
    { id: 'bottom', from: 2 / 3, to: 1 },
  ],
  grid = 96,
): BandedInteriorComparisonResult {
  validateFrame(reference, 'Reference frame');
  validateFrame(render, 'Render frame');
  if (!Number.isInteger(grid) || grid < 8 || grid > 192) throw new Error('Interior comparison grid must be an integer from 8 to 192.');
  if (!Array.isArray(bands) || bands.length < 1 || bands.length > 32) throw new Error('Interior comparison requires 1..32 bands.');
  const ids = new Set<string>();
  for (const band of bands) {
    if (!/^[a-zA-Z0-9_-]{1,96}$/.test(band.id) || ids.has(band.id)
      || !Number.isFinite(band.from) || !Number.isFinite(band.to)
      || band.from < 0 || band.to > 1 || band.from >= band.to) {
      throw new Error(`Interior comparison band is invalid: ${band.id}`);
    }
    ids.add(band.id);
  }
  const referenceSample = sampleNormalizedInterior(reference, grid);
  const renderSample = sampleNormalizedInterior(render, grid);
  const scores = bands.map<InteriorBandScore>((band) => {
    if (!referenceSample || !renderSample) {
      return { ...band, cellsCompared: 0, interiorDifference: null, interiorSimilarity: null, status: 'no-overlapping-foreground-cells' };
    }
    const firstRow = Math.floor(band.from * grid);
    const lastRow = Math.max(firstRow + 1, Math.min(grid, Math.floor(band.to * grid)));
    let difference = 0;
    let cellsCompared = 0;
    for (let y = firstRow; y < lastRow; y += 1) {
      for (let x = 0; x < grid; x += 1) {
        const index = y * grid + x;
        if (!referenceSample.solid[index] || !renderSample.solid[index]) continue;
        difference += Math.abs(referenceSample.luma[index] - renderSample.luma[index]);
        cellsCompared += 1;
      }
    }
    if (cellsCompared === 0) {
      return { ...band, cellsCompared, interiorDifference: null, interiorSimilarity: null, status: 'no-overlapping-foreground-cells' };
    }
    const interiorDifference = difference / cellsCompared;
    return { ...band, cellsCompared, interiorDifference, interiorSimilarity: 1 - interiorDifference, status: 'measured' };
  });
  const measured = scores.filter((score): score is InteriorBandScore & { interiorSimilarity: number } => score.interiorSimilarity !== null);
  const cellsCompared = measured.reduce((sum, score) => sum + score.cellsCompared, 0);
  const aggregateSimilarity = cellsCompared === 0
    ? null
    : measured.reduce((sum, score) => sum + score.interiorSimilarity * score.cellsCompared, 0) / cellsCompared;
  return { method: 'foreground-normalized-bands-v1', grid, bands: scores, aggregateSimilarity, cellsCompared };
}
