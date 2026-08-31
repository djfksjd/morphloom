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
      return { featureId: region.featureId, silhouetteIoU: score.silhouetteIoU, interiorSimilarity: score.interiorSimilarity, score: score.score };
    }),
  };
}
