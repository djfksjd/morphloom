import * as THREE from 'three';

const MAX_REFERENCE_PIXELS = 4_194_304;
const HEIGHT_QUANTIZATION = 32_767;
export const MAX_REFERENCE_HEIGHT_SAMPLES = 16_384;

export interface ReferenceSurfaceMetrics {
  normalizedEntropy: number;
  meanGradient: number;
  heightDeviation: number;
  fineDeviation: number;
  mediumDeviation: number;
  coarseDeviation: number;
  multiScaleBalance: number;
  periodicity: number;
  irregularity: number;
}

export interface ReferenceSurfaceAnalysis {
  width: number;
  height: number;
  heights: Float32Array;
  normalRgba: Uint8ClampedArray;
  roughnessRgba: Uint8ClampedArray;
  metrics: ReferenceSurfaceMetrics;
}

export interface QuantizedReferenceHeightField {
  method: 'image-highpass-height-v1' | 'image-multiscale-height-v2';
  width: number;
  height: number;
  samples: number[];
  amplitudeMm: number;
  blend: number;
  fingerprint: string;
  irregularity: number;
}

function rms(values: Float32Array): number {
  let squared = 0;
  for (const value of values) squared += value * value;
  return Math.sqrt(squared / Math.max(1, values.length));
}

function assertImageInput(pixels: Uint8Array | Uint8ClampedArray, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error('Reference surface dimensions must be integers of at least 2 × 2.');
  }
  const pixelCount = width * height;
  if (pixelCount > MAX_REFERENCE_PIXELS) throw new Error('Reference surface exceeds the bounded pixel budget.');
  if (pixels.length !== pixelCount * 4) throw new Error('Reference surface RGBA length does not match its dimensions.');
}

function buildIntegral(values: Float32Array, width: number, height: number): Float32Array {
  const stride = width + 1;
  const integral = new Float32Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += values[y * width + x]!;
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1]! + rowSum;
    }
  }
  return integral;
}

function boxMean(
  integral: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  radius: number,
): number {
  const stride = width + 1;
  const minX = Math.max(0, x - radius);
  const maxX = Math.min(width - 1, x + radius);
  const minY = Math.max(0, y - radius);
  const maxY = Math.min(height - 1, y + radius);
  const sum = integral[(maxY + 1) * stride + maxX + 1]!
    - integral[minY * stride + maxX + 1]!
    - integral[(maxY + 1) * stride + minX]!
    + integral[minY * stride + minX]!;
  return sum / ((maxX - minX + 1) * (maxY - minY + 1));
}

function normalizedCorrelation(values: Float32Array, width: number, height: number, offsetX: number, offsetY: number): number {
  let dot = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  let samples = 0;
  for (let y = 0; y < height - offsetY; y += 1) {
    for (let x = 0; x < width - offsetX; x += 1) {
      const left = values[y * width + x]!;
      const right = values[(y + offsetY) * width + x + offsetX]!;
      dot += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
      samples += 1;
    }
  }
  if (samples === 0 || leftEnergy <= 1e-12 || rightEnergy <= 1e-12) return 0;
  return Math.abs(dot / Math.sqrt(leftEnergy * rightEnergy));
}

/**
 * Separates broad illumination from local structure and derives a bounded set
 * of image-conditioned PBR signals. Brightness remains only a depth proxy; the
 * caller must keep physical height evidence separate from this visual estimate.
 */
export function analyzeReferenceSurface(
  pixels: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  strength = 1,
): ReferenceSurfaceAnalysis {
  assertImageInput(pixels, width, height);
  if (!Number.isFinite(strength) || strength < 0 || strength > 2) {
    throw new Error('Reference surface strength must be between 0 and 2.');
  }
  const count = width * height;
  const luminance = new Float32Array(count);
  const histogram = new Uint32Array(32);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const alpha = pixels[offset + 3]! / 255;
    const value = ((pixels[offset]! * 0.2126 + pixels[offset + 1]! * 0.7152 + pixels[offset + 2]! * 0.0722) / 255) * alpha;
    luminance[index] = value;
    histogram[Math.min(31, Math.floor(value * 32))] += 1;
  }
  const integral = buildIntegral(luminance, width, height);
  const shortestSide = Math.min(width, height);
  const fineRadius = Math.max(1, Math.round(shortestSide * 0.006));
  const mediumRadius = Math.max(fineRadius + 1, Math.round(shortestSide * 0.022));
  const coarseRadius = Math.max(mediumRadius + 1, Math.round(shortestSide * 0.075));
  const fineBand = new Float32Array(count);
  const mediumBand = new Float32Array(count);
  const coarseBand = new Float32Array(count);
  const highpass = new Float32Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const fineMean = boxMean(integral, width, height, x, y, fineRadius);
      const mediumMean = boxMean(integral, width, height, x, y, mediumRadius);
      const coarseMean = boxMean(integral, width, height, x, y, coarseRadius);
      const fine = luminance[index]! - fineMean;
      const medium = fineMean - mediumMean;
      const coarse = mediumMean - coarseMean;
      fineBand[index] = fine;
      mediumBand[index] = medium;
      coarseBand[index] = coarse;
      // Fine facets remain crisp while medium aggregate and broad cavities are
      // retained at lower amplitude instead of being erased as illumination.
      highpass[index] = fine * 0.58 + medium * 0.3 + coarse * 0.12;
    }
  }
  const fineDeviation = rms(fineBand);
  const mediumDeviation = rms(mediumBand);
  const coarseDeviation = rms(coarseBand);
  const deviation = rms(highpass);
  const normalizer = Math.max(deviation * 2.8, 1 / 255);
  const heights = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    heights[index] = THREE.MathUtils.clamp(highpass[index]! / normalizer, -1, 1);
  }

  const normalRgba = new Uint8ClampedArray(count * 4);
  const roughnessRgba = new Uint8ClampedArray(count * 4);
  let gradientSum = 0;
  const heightAt = (x: number, y: number) => heights[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]!;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength * 1.9;
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength * 1.9;
      const length = Math.hypot(dx, dy, 1);
      normalRgba[offset] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      normalRgba[offset + 1] = Math.round(((dy / length) * 0.5 + 0.5) * 255);
      normalRgba[offset + 2] = Math.round(1 / length * 255);
      normalRgba[offset + 3] = 255;
      const gradient = Math.min(1, Math.hypot(dx, dy));
      gradientSum += gradient;
      const roughness = Math.round(THREE.MathUtils.lerp(184, 255, gradient));
      roughnessRgba.set([roughness, roughness, roughness, 255], offset);
    }
  }

  let entropy = 0;
  for (const bin of histogram) {
    if (bin === 0) continue;
    const probability = bin / count;
    entropy -= probability * Math.log2(probability);
  }
  const normalizedEntropy = entropy / Math.log2(histogram.length);
  const periodicity = Math.max(
    normalizedCorrelation(heights, width, height, Math.max(1, Math.floor(width / 4)), 0),
    normalizedCorrelation(heights, width, height, 0, Math.max(1, Math.floor(height / 4))),
  );
  const meanGradient = gradientSum / count;
  const scaleTotal = fineDeviation + mediumDeviation + coarseDeviation;
  const activeScales = scaleTotal <= 1e-12 ? 0 : [fineDeviation, mediumDeviation, coarseDeviation]
    .filter((value) => value / scaleTotal >= 0.08).length;
  const multiScaleBalance = activeScales / 3;
  const irregularity = THREE.MathUtils.clamp(
    normalizedEntropy * 0.3
      + Math.min(1, meanGradient * 2.8) * 0.34
      + (1 - periodicity) * 0.2
      + multiScaleBalance * 0.16,
    0,
    1,
  );
  return {
    width,
    height,
    heights,
    normalRgba,
    roughnessRgba,
    metrics: {
      normalizedEntropy,
      meanGradient,
      heightDeviation: deviation,
      fineDeviation,
      mediumDeviation,
      coarseDeviation,
      multiScaleBalance,
      periodicity,
      irregularity,
    },
  };
}

export function quantizeReferenceHeightField(
  analysis: ReferenceSurfaceAnalysis,
  width: number,
  height: number,
  amplitudeMm: number,
  blend: number,
  fingerprint: string,
): QuantizedReferenceHeightField {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2
    || width * height > MAX_REFERENCE_HEIGHT_SAMPLES) {
    throw new Error(`Reference height field must contain 4–${MAX_REFERENCE_HEIGHT_SAMPLES} samples.`);
  }
  if (!Number.isFinite(amplitudeMm) || amplitudeMm <= 0 || amplitudeMm > 100) {
    throw new Error('Reference height amplitude is invalid.');
  }
  if (!Number.isFinite(blend) || blend < 0 || blend > 1) throw new Error('Reference height blend is invalid.');
  if (!/^[a-f0-9]{8,128}$/i.test(fingerprint)) throw new Error('Reference height fingerprint is invalid.');
  const samples = new Array<number>(width * height);
  const sourceAt = (x: number, y: number) => analysis.heights[
    Math.max(0, Math.min(analysis.height - 1, y)) * analysis.width
      + Math.max(0, Math.min(analysis.width - 1, x))
  ]!;
  for (let y = 0; y < height; y += 1) {
    const sourceY = y / (height - 1) * (analysis.height - 1);
    const y0 = Math.floor(sourceY);
    const y1 = Math.min(analysis.height - 1, y0 + 1);
    const ty = sourceY - y0;
    for (let x = 0; x < width; x += 1) {
      const sourceX = x / (width - 1) * (analysis.width - 1);
      const x0 = Math.floor(sourceX);
      const x1 = Math.min(analysis.width - 1, x0 + 1);
      const tx = sourceX - x0;
      const top = THREE.MathUtils.lerp(sourceAt(x0, y0), sourceAt(x1, y0), tx);
      const bottom = THREE.MathUtils.lerp(sourceAt(x0, y1), sourceAt(x1, y1), tx);
      samples[y * width + x] = Math.round(THREE.MathUtils.lerp(top, bottom, ty) * HEIGHT_QUANTIZATION);
    }
  }
  return {
    method: 'image-multiscale-height-v2',
    width,
    height,
    samples,
    amplitudeMm,
    blend,
    fingerprint: fingerprint.toLowerCase(),
    irregularity: analysis.metrics.irregularity,
  };
}

export function sampleQuantizedReferenceHeight(
  field: QuantizedReferenceHeightField,
  u: number,
  v: number,
): number {
  const x = THREE.MathUtils.clamp(u, 0, 1) * (field.width - 1);
  const y = (1 - THREE.MathUtils.clamp(v, 0, 1)) * (field.height - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(field.width - 1, x0 + 1);
  const y1 = Math.min(field.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const at = (sampleX: number, sampleY: number) => field.samples[sampleY * field.width + sampleX]! / HEIGHT_QUANTIZATION;
  const top = THREE.MathUtils.lerp(at(x0, y0), at(x1, y0), tx);
  const bottom = THREE.MathUtils.lerp(at(x0, y1), at(x1, y1), tx);
  return THREE.MathUtils.lerp(top, bottom, ty) * field.amplitudeMm;
}
