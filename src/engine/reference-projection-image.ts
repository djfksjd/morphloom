export interface OpaqueProjectionImage {
  rgba: Uint8ClampedArray;
  filledPixels: number;
  sourcePixels: number;
}

export interface ReferenceDelightMetrics {
  method: 'bounded-linear-illumination-field-v1';
  strength: number;
  lightingField: [number, number];
  radius: number;
  targetLinearLuma: number;
  lumaRangeBefore: number;
  lumaRangeAfter: number;
  meanCorrection: number;
  minimumCorrection: number;
  maximumCorrection: number;
  clippedFraction: number;
  /** Single-image inverse-lighting is ambiguous, so this value is deliberately capped. */
  confidence: number;
}

export interface DelightedProjectionImage {
  rgba: Uint8ClampedArray;
  metrics: ReferenceDelightMetrics;
}

const MAX_PROJECTION_PIXELS = 16_777_216;
const MAX_LIGHTING_FIELD_EDGE = 384;

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function linearToSrgbByte(value: number): number {
  const bounded = Math.max(0, Math.min(1, value));
  const srgb = bounded <= 0.0031308 ? bounded * 12.92 : 1.055 * bounded ** (1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function luma(red: number, green: number, blue: number): number {
  return red * 0.2126 + green * 0.7152 + blue * 0.0722;
}

function percentileFromHistogram(histogram: Uint32Array, fraction: number): number {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  const target = Math.max(0, Math.min(total - 1, Math.round(fraction * Math.max(0, total - 1))));
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index]!;
    if (seen > target) return index / (histogram.length - 1);
  }
  return 0;
}

function blurField(values: Float32Array, width: number, height: number, radius: number): Float32Array {
  const horizontal = new Float32Array(values.length);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    let count = 0;
    for (let x = -radius; x < width + radius; x += 1) {
      if (x >= 0 && x < width) {
        sum += values[y * width + x]!;
        count += 1;
      }
      const remove = x - radius * 2 - 1;
      if (remove >= 0 && remove < width) {
        sum -= values[y * width + remove]!;
        count -= 1;
      }
      const writeX = x - radius;
      if (writeX >= 0 && writeX < width) horizontal[y * width + writeX] = sum / Math.max(1, count);
    }
  }
  const output = new Float32Array(values.length);
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    let count = 0;
    for (let y = -radius; y < height + radius; y += 1) {
      if (y >= 0 && y < height) {
        sum += horizontal[y * width + x]!;
        count += 1;
      }
      const remove = y - radius * 2 - 1;
      if (remove >= 0 && remove < height) {
        sum -= horizontal[remove * width + x]!;
        count -= 1;
      }
      const writeY = y - radius;
      if (writeY >= 0 && writeY < height) output[writeY * width + x] = sum / Math.max(1, count);
    }
  }
  return output;
}

/**
 * Removes only broad photographed illumination from a reference plate in
 * linear light. The lighting field is downsampled before blurring, so peak
 * memory is bounded even for the largest admitted plate. Fine colour,
 * scratches and aggregate remain in albedo while downstream normal/roughness
 * derivation sees the same de-lit pixels.
 *
 * This is a conservative single-image estimate, never recovered ground-truth
 * albedo. Metrics expose the correction and cap its confidence accordingly.
 */
export function delightReferenceProjection(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  strength = 0.2,
): DelightedProjectionImage {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || !Number.isSafeInteger(count) || count > MAX_PROJECTION_PIXELS
    || source.length !== count * 4
    || !Number.isFinite(strength) || strength < 0 || strength > 1) {
    throw new Error('Reference de-light input is invalid or exceeds the pixel budget.');
  }
  const scale = Math.min(1, MAX_LIGHTING_FIELD_EDGE / Math.max(width, height));
  const fieldWidth = Math.max(2, Math.round(width * scale));
  const fieldHeight = Math.max(2, Math.round(height * scale));
  const fieldSize = fieldWidth * fieldHeight;
  const sums = new Float64Array(fieldSize);
  const samples = new Uint32Array(fieldSize);
  const beforeHistogram = new Uint32Array(256);
  for (let y = 0; y < height; y += 1) {
    const fieldY = Math.min(fieldHeight - 1, Math.floor(y * fieldHeight / height));
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const linearLuma = luma(
        srgbToLinear(source[offset]!),
        srgbToLinear(source[offset + 1]!),
        srgbToLinear(source[offset + 2]!),
      );
      const fieldX = Math.min(fieldWidth - 1, Math.floor(x * fieldWidth / width));
      const fieldIndex = fieldY * fieldWidth + fieldX;
      sums[fieldIndex] += linearLuma;
      samples[fieldIndex] += 1;
      beforeHistogram[Math.min(255, Math.round(linearLuma * 255))] += 1;
    }
  }
  const field = new Float32Array(fieldSize);
  for (let index = 0; index < fieldSize; index += 1) field[index] = sums[index]! / Math.max(1, samples[index]!);
  const radius = Math.max(3, Math.min(28, Math.round(Math.min(fieldWidth, fieldHeight) / 18)));
  const lighting = blurField(field, fieldWidth, fieldHeight, radius);
  // Preserve the plate's global exposure instead of forcing it to its median.
  // The median is biased dark for products containing narrow bright metal,
  // black openings and a dominant mid-tone body; normalizing to it made the
  // whole asset drift darker even when the illumination gradient improved.
  const target = Math.max(0.025, Math.min(0.9, sums.reduce((sum, value) => sum + value, 0) / count));
  const output = new Uint8ClampedArray(source.length);
  const afterHistogram = new Uint32Array(256);
  let correctionSum = 0;
  let minimumCorrection = Infinity;
  let maximumCorrection = -Infinity;
  let clipped = 0;
  for (let y = 0; y < height; y += 1) {
    const fieldY = Math.min(fieldHeight - 1, Math.floor(y * fieldHeight / height));
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const fieldX = Math.min(fieldWidth - 1, Math.floor(x * fieldWidth / width));
      const localLight = Math.max(0.02, lighting[fieldY * fieldWidth + fieldX]!);
      const rawCorrection = (target / localLight) ** strength;
      const correction = Math.max(0.55, Math.min(1.8, rawCorrection));
      if (correction !== rawCorrection) clipped += 1;
      correctionSum += correction;
      minimumCorrection = Math.min(minimumCorrection, correction);
      maximumCorrection = Math.max(maximumCorrection, correction);
      const red = Math.min(1, srgbToLinear(source[offset]!) * correction);
      const green = Math.min(1, srgbToLinear(source[offset + 1]!) * correction);
      const blue = Math.min(1, srgbToLinear(source[offset + 2]!) * correction);
      output[offset] = linearToSrgbByte(red);
      output[offset + 1] = linearToSrgbByte(green);
      output[offset + 2] = linearToSrgbByte(blue);
      output[offset + 3] = source[offset + 3]!;
      afterHistogram[Math.min(255, Math.round(luma(red, green, blue) * 255))] += 1;
    }
  }
  const beforeRange = percentileFromHistogram(beforeHistogram, 0.95) - percentileFromHistogram(beforeHistogram, 0.05);
  const afterRange = percentileFromHistogram(afterHistogram, 0.95) - percentileFromHistogram(afterHistogram, 0.05);
  const confidence = Math.min(0.72, Math.max(0.32, 0.66 - Math.max(0, beforeRange - 0.35) * 0.3));
  return {
    rgba: output,
    metrics: {
      method: 'bounded-linear-illumination-field-v1',
      strength,
      lightingField: [fieldWidth, fieldHeight],
      radius,
      targetLinearLuma: target,
      lumaRangeBefore: beforeRange,
      lumaRangeAfter: afterRange,
      meanCorrection: correctionSum / count,
      minimumCorrection,
      maximumCorrection,
      clippedFraction: clipped / count,
      confidence,
    },
  };
}

/**
 * Extends the nearest admitted source colour through transparent texels.
 * Geometry owns the silhouette and true openings, so reference alpha must not
 * introduce black fringes where filtered UVs cross an antialiased bitmap edge.
 */
export function extendOpaqueProjectionColors(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  alphaThreshold = 16,
): OpaqueProjectionImage {
  const count = width * height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1
    || !Number.isSafeInteger(count) || count > MAX_PROJECTION_PIXELS
    || source.length !== count * 4
    || !Number.isInteger(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 254) {
    throw new Error('Reference projection image is invalid or exceeds the pixel budget.');
  }
  const rgba = new Uint8ClampedArray(source);
  const queue = new Int32Array(count);
  const admitted = new Uint8Array(count);
  let head = 0;
  let tail = 0;
  for (let pixel = 0; pixel < count; pixel += 1) {
    if (rgba[pixel * 4 + 3] <= alphaThreshold) continue;
    admitted[pixel] = 1;
    queue[tail++] = pixel;
    rgba[pixel * 4 + 3] = 255;
  }
  if (tail === 0) throw new Error('Reference projection contains no opaque source pixels.');
  const sourcePixels = tail;
  const admit = (pixel: number, from: number) => {
    if (admitted[pixel]) return;
    admitted[pixel] = 1;
    const target = pixel * 4;
    const origin = from * 4;
    rgba[target] = rgba[origin];
    rgba[target + 1] = rgba[origin + 1];
    rgba[target + 2] = rgba[origin + 2];
    rgba[target + 3] = 255;
    queue[tail++] = pixel;
  };
  while (head < tail) {
    const pixel = queue[head++];
    const x = pixel % width;
    if (x > 0) admit(pixel - 1, pixel);
    if (x + 1 < width) admit(pixel + 1, pixel);
    if (pixel >= width) admit(pixel - width, pixel);
    if (pixel + width < count) admit(pixel + width, pixel);
  }
  return { rgba, filledPixels: count - sourcePixels, sourcePixels };
}
