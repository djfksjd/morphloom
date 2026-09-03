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
  /** Robust image-space gradient used to normalize tangent-space normals. */
  normalGradientP90: number;
  /** RMS tangent slope after robust normalization; stable across source resolution. */
  normalSlopeRms: number;
  /** Standard deviation of the generated roughness signal in normalized units. */
  roughnessDeviation: number;
  /** Bounded confidence that local contrast exceeds the absolute noise floor. */
  surfaceSignalConfidence: number;
}

export interface ReferenceSurfaceAnalysis {
  width: number;
  height: number;
  heights: Float32Array;
  normalRgba: Uint8ClampedArray;
  roughnessRgba: Uint8ClampedArray;
  metrics: ReferenceSurfaceMetrics;
}

export interface MaskedReferenceSurfaceInput {
  id: string;
  fingerprint: string;
  width: number;
  height: number;
  rgba: Uint8Array | Uint8ClampedArray;
  mask: Uint8Array;
}

export interface MaskedReferenceSurfaceDerivation {
  schema: 'morphloom.masked-reference-surface/0.1';
  selectedSourceId: string;
  selectedSourceFingerprint: string;
  /** Exact source-image crop used to derive the repeatable material tile. */
  sourceRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
    selection: 'object-bounds' | 'dense-interior-patch';
  };
  sourceForegroundPixels: number;
  sourceInteriorPixels: number;
  textureSize: number;
  seededTexels: number;
  inpaintedTexels: number;
  materialSuitability: {
    pass: boolean;
    foregroundFillRatio: number;
    interiorFillRatio: number;
    seededTexelRatio: number;
    blockers: string[];
  };
  /** Background-excluded source pixels after deterministic hole filling. */
  sourceAlbedoRgba: Uint8ClampedArray;
  /** Neutral micro-contrast modulation for preserving an authored base colour. */
  albedoRgba: Uint8ClampedArray;
  analysis: ReferenceSurfaceAnalysis;
}

export interface ReferenceSurfaceEvidenceAudit {
  schema: 'morphloom.reference-surface-evidence/0.1';
  expectation: 'irregular-granular';
  pass: boolean;
  score: number;
  checks: Array<{ id: string; pass: boolean; score: number; measured: number; threshold: string }>;
  blockers: string[];
}

export interface QuantizedReferenceHeightField {
  method: 'image-highpass-height-v1' | 'image-multiscale-height-v2' | 'image-multiscale-height-v3';
  width: number;
  height: number;
  samples: number[];
  amplitudeMm: number;
  blend: number;
  fingerprint: string;
  irregularity: number;
}

function srgbByteToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function percentileFromHistogram(histogram: Uint32Array, fraction: number, maximum: number): number {
  const total = histogram.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  const target = Math.max(0, Math.min(total - 1, Math.round(fraction * (total - 1))));
  let seen = 0;
  for (let index = 0; index < histogram.length; index += 1) {
    seen += histogram[index]!;
    if (seen > target) return index / (histogram.length - 1) * maximum;
  }
  return maximum;
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

const SAFE_SOURCE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$/;
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Extracts a bounded, background-free material tile from one or more object
 * masks. The densest eroded foreground view is selected deterministically;
 * empty texels are filled from the nearest real foreground texel before any
 * surface signal is derived. This prevents white studio backgrounds and hard
 * silhouette edges from being mistaken for material relief.
 */
export function deriveMaskedReferenceSurface(
  inputs: MaskedReferenceSurfaceInput[],
  options: { textureSize?: number; strength?: number; localizedPatch?: boolean } = {},
): MaskedReferenceSurfaceDerivation {
  const textureSize = options.textureSize ?? 128;
  const strength = options.strength ?? 0.72;
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 16
    || !Number.isInteger(textureSize) || textureSize < 16 || textureSize > 512
    || !Number.isFinite(strength) || strength < 0 || strength > 2) {
    throw new Error('Masked reference surface request is outside safe bounds.');
  }
  const candidates = inputs.map((input, inputIndex) => {
    assertImageInput(input.rgba, input.width, input.height);
    if (!SAFE_SOURCE_ID.test(input.id) || !SHA256.test(input.fingerprint)
      || !(input.mask instanceof Uint8Array) || input.mask.length !== input.width * input.height
      || input.mask.some((value) => value !== 0 && value !== 1)) {
      throw new Error(`Masked reference source is invalid: ${input?.id ?? inputIndex}.`);
    }
    let foreground = 0;
    let interior = 0;
    let minimumX = input.width;
    let minimumY = input.height;
    let maximumX = -1;
    let maximumY = -1;
    const interiorMask = new Uint8Array(input.mask.length);
    for (let y = 0; y < input.height; y += 1) for (let x = 0; x < input.width; x += 1) {
      const index = y * input.width + x;
      if (input.mask[index] !== 1) continue;
      foreground += 1;
      minimumX = Math.min(minimumX, x); maximumX = Math.max(maximumX, x);
      minimumY = Math.min(minimumY, y); maximumY = Math.max(maximumY, y);
      if (x > 0 && y > 0 && x + 1 < input.width && y + 1 < input.height
        && input.mask[index - 1] === 1 && input.mask[index + 1] === 1
        && input.mask[index - input.width] === 1 && input.mask[index + input.width] === 1) {
        interiorMask[index] = 1;
        interior += 1;
      }
    }
    if (foreground < 16 || maximumX <= minimumX || maximumY <= minimumY) {
      throw new Error(`Masked reference source has insufficient foreground: ${input.id}.`);
    }
    let region: {
      minimumX: number;
      minimumY: number;
      maximumX: number;
      maximumY: number;
      foreground: number;
      interior: number;
      selection: 'object-bounds' | 'dense-interior-patch';
    } = {
      minimumX, minimumY, maximumX, maximumY, foreground, interior,
      selection: 'object-bounds',
    };
    if (options.localizedPatch) {
      const maskIntegral = new Uint32Array((input.width + 1) * (input.height + 1));
      const interiorIntegral = new Uint32Array(maskIntegral.length);
      const stride = input.width + 1;
      for (let y = 0; y < input.height; y += 1) {
        let maskRow = 0;
        let interiorRow = 0;
        for (let x = 0; x < input.width; x += 1) {
          const sourceIndex = y * input.width + x;
          maskRow += input.mask[sourceIndex]!;
          interiorRow += interiorMask[sourceIndex]!;
          maskIntegral[(y + 1) * stride + x + 1] = maskIntegral[y * stride + x + 1]! + maskRow;
          interiorIntegral[(y + 1) * stride + x + 1] = interiorIntegral[y * stride + x + 1]! + interiorRow;
        }
      }
      const rectangleSum = (integral: Uint32Array, x: number, y: number, width: number, height: number): number => (
        integral[(y + height) * stride + x + width]!
        - integral[y * stride + x + width]!
        - integral[(y + height) * stride + x]!
        + integral[y * stride + x]!
      );
      const objectWidth = maximumX - minimumX + 1;
      const objectHeight = maximumY - minimumY + 1;
      const maximumPatchSpan = Math.min(objectWidth, objectHeight);
      const minimumPatchSpan = Math.max(16, Math.floor(maximumPatchSpan * 0.1));
      let best: typeof region | undefined;
      const spans = [...new Set([0.5, 0.4, 0.32, 0.25, 0.2, 0.16, 0.12, 0.1]
        .map((fraction) => Math.max(minimumPatchSpan, Math.floor(maximumPatchSpan * fraction))))]
        .filter((span) => span >= minimumPatchSpan && span <= maximumPatchSpan)
        .sort((left, right) => right - left);
      for (const span of spans) {
        const step = Math.max(1, Math.floor(span / 8));
        const lastX = maximumX - span + 1;
        const lastY = maximumY - span + 1;
        const xs = [...new Set(Array.from(
          { length: Math.max(1, Math.floor((lastX - minimumX) / step) + 1) },
          (_, index) => Math.min(lastX, minimumX + index * step),
        ).concat(lastX))];
        const ys = [...new Set(Array.from(
          { length: Math.max(1, Math.floor((lastY - minimumY) / step) + 1) },
          (_, index) => Math.min(lastY, minimumY + index * step),
        ).concat(lastY))];
        for (const y of ys) for (const x of xs) {
          if (x < minimumX || y < minimumY || x > lastX || y > lastY) continue;
          const pixels = span * span;
          const patchForeground = rectangleSum(maskIntegral, x, y, span, span);
          const patchInterior = rectangleSum(interiorIntegral, x, y, span, span);
          if (patchForeground / pixels < 0.94 || patchInterior / pixels < 0.86) continue;
          const candidate = {
            minimumX: x, minimumY: y, maximumX: x + span - 1, maximumY: y + span - 1,
            foreground: patchForeground, interior: patchInterior,
            selection: 'dense-interior-patch' as const,
          };
          if (!best || span > best.maximumX - best.minimumX + 1
            || (span === best.maximumX - best.minimumX + 1 && patchInterior > best.interior)
            || (span === best.maximumX - best.minimumX + 1 && patchInterior === best.interior
              && (y < best.minimumY || (y === best.minimumY && x < best.minimumX)))) {
            best = candidate;
          }
        }
        if (best) break;
      }
      if (best) region = best;
    }
    return {
      input, inputIndex, interiorMask,
      foreground: region.foreground, interior: region.interior,
      minimumX: region.minimumX, minimumY: region.minimumY,
      maximumX: region.maximumX, maximumY: region.maximumY,
      selection: region.selection,
    };
  });
  candidates.sort((left, right) => right.interior - left.interior
    || right.foreground - left.foreground || left.input.id.localeCompare(right.input.id)
    || left.inputIndex - right.inputIndex);
  const selected = candidates[0]!;
  const activeMask = selected.interior >= 16 ? selected.interiorMask : selected.input.mask;
  const seeded = new Uint8ClampedArray(textureSize * textureSize * 4);
  const valid = new Uint8Array(textureSize * textureSize);
  const cropWidth = selected.maximumX - selected.minimumX + 1;
  const cropHeight = selected.maximumY - selected.minimumY + 1;
  let seededTexels = 0;
  for (let targetY = 0; targetY < textureSize; targetY += 1) {
    const sourceMinY = selected.minimumY + Math.floor(targetY * cropHeight / textureSize);
    const sourceMaxY = selected.minimumY + Math.max(0, Math.ceil((targetY + 1) * cropHeight / textureSize) - 1);
    for (let targetX = 0; targetX < textureSize; targetX += 1) {
      const sourceMinX = selected.minimumX + Math.floor(targetX * cropWidth / textureSize);
      const sourceMaxX = selected.minimumX + Math.max(0, Math.ceil((targetX + 1) * cropWidth / textureSize) - 1);
      const sums = [0, 0, 0];
      let samples = 0;
      for (let sourceY = sourceMinY; sourceY <= sourceMaxY; sourceY += 1) {
        for (let sourceX = sourceMinX; sourceX <= sourceMaxX; sourceX += 1) {
          const sourceIndex = sourceY * selected.input.width + sourceX;
          if (activeMask[sourceIndex] !== 1) continue;
          const sourceOffset = sourceIndex * 4;
          sums[0] += selected.input.rgba[sourceOffset]!;
          sums[1] += selected.input.rgba[sourceOffset + 1]!;
          sums[2] += selected.input.rgba[sourceOffset + 2]!;
          samples += 1;
        }
      }
      if (samples === 0) continue;
      const targetIndex = targetY * textureSize + targetX;
      const targetOffset = targetIndex * 4;
      seeded[targetOffset] = Math.round(sums[0] / samples);
      seeded[targetOffset + 1] = Math.round(sums[1] / samples);
      seeded[targetOffset + 2] = Math.round(sums[2] / samples);
      seeded[targetOffset + 3] = 255;
      valid[targetIndex] = 1;
      seededTexels += 1;
    }
  }
  if (seededTexels < 4) throw new Error('Masked reference surface produced too few material texels.');
  const queue = new Int32Array(valid.length);
  let head = 0;
  let tail = 0;
  for (let index = 0; index < valid.length; index += 1) if (valid[index] === 1) queue[tail++] = index;
  const neighbors = [-1, 1, -textureSize, textureSize];
  while (head < tail) {
    const sourceIndex = queue[head++]!;
    const sourceX = sourceIndex % textureSize;
    for (const delta of neighbors) {
      const targetIndex = sourceIndex + delta;
      if (targetIndex < 0 || targetIndex >= valid.length || valid[targetIndex] === 1) continue;
      if ((delta === -1 && sourceX === 0) || (delta === 1 && sourceX === textureSize - 1)) continue;
      const sourceOffset = sourceIndex * 4;
      const targetOffset = targetIndex * 4;
      seeded.set(seeded.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      valid[targetIndex] = 1;
      queue[tail++] = targetIndex;
    }
  }
  const analysis = analyzeReferenceSurface(seeded, textureSize, textureSize, strength);
  const cropPixels = cropWidth * cropHeight;
  const foregroundFillRatio = selected.foreground / cropPixels;
  const interiorFillRatio = selected.interior / cropPixels;
  const seededTexelRatio = seededTexels / (textureSize * textureSize);
  const suitabilityBlockers = [
    foregroundFillRatio < 0.55
      ? `foreground fill ${foregroundFillRatio.toFixed(3)} is too sparse for a stationary material patch`
      : undefined,
    interiorFillRatio < 0.42
      ? `eroded interior fill ${interiorFillRatio.toFixed(3)} is dominated by silhouettes or structural gaps`
      : undefined,
    seededTexelRatio < 0.5
      ? `sampled texel fill ${seededTexelRatio.toFixed(3)} requires excessive structural inpainting`
      : undefined,
  ].filter((blocker): blocker is string => Boolean(blocker));
  const albedoRgba = new Uint8ClampedArray(seeded.length);
  for (let index = 0; index < analysis.heights.length; index += 1) {
    const sourceOffset = index * 4;
    const microGain = THREE.MathUtils.clamp(0.94 + analysis.heights[index]! * 0.06, 0.82, 1);
    albedoRgba[sourceOffset] = Math.round(microGain * 255);
    albedoRgba[sourceOffset + 1] = Math.round(microGain * 255);
    albedoRgba[sourceOffset + 2] = Math.round(microGain * 255);
    albedoRgba[sourceOffset + 3] = 255;
  }
  return {
    schema: 'morphloom.masked-reference-surface/0.1',
    selectedSourceId: selected.input.id,
    selectedSourceFingerprint: selected.input.fingerprint,
    sourceRegion: {
      x: selected.minimumX,
      y: selected.minimumY,
      width: cropWidth,
      height: cropHeight,
      selection: selected.selection,
    },
    sourceForegroundPixels: selected.foreground,
    sourceInteriorPixels: selected.interior,
    textureSize,
    seededTexels,
    inpaintedTexels: textureSize * textureSize - seededTexels,
    materialSuitability: {
      pass: suitabilityBlockers.length === 0,
      foregroundFillRatio,
      interiorFillRatio,
      seededTexelRatio,
      blockers: suitabilityBlockers,
    },
    sourceAlbedoRgba: new Uint8ClampedArray(seeded),
    albedoRgba,
    analysis,
  };
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
    // Surface gradients are a lighting calculation. Work in linear light so
    // an sRGB gamma curve cannot turn the same physical contrast into a
    // different height or normal response.
    const value = (
      srgbByteToLinear(pixels[offset]!) * 0.2126
      + srgbByteToLinear(pixels[offset + 1]!) * 0.7152
      + srgbByteToLinear(pixels[offset + 2]!) * 0.0722
    ) * alpha;
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
  // Do not amplify one-code-value sensor/compression noise into full relief.
  const normalizer = Math.max(deviation * 2.8, 0.012);
  const heights = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    heights[index] = THREE.MathUtils.clamp(highpass[index]! / normalizer, -1, 1);
  }

  const normalRgba = new Uint8ClampedArray(count * 4);
  const roughnessRgba = new Uint8ClampedArray(count * 4);
  const heightAt = (x: number, y: number) => heights[Math.max(0, Math.min(height - 1, y)) * width + Math.max(0, Math.min(width - 1, x))]!;
  // Reuse the no-longer-needed high-pass buffer to keep the maximum image
  // analysis allocation bounded. A robust percentile makes normal strength
  // invariant to uniform source resampling and prevents a handful of hot
  // pixels from flattening the rest of the surface.
  const gradientMagnitudes = highpass;
  const gradientHistogram = new Uint32Array(256);
  const maximumGradient = Math.SQRT2 * 2;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const magnitude = Math.hypot(
        heightAt(x + 1, y) - heightAt(x - 1, y),
        heightAt(x, y + 1) - heightAt(x, y - 1),
      );
      gradientMagnitudes[y * width + x] = magnitude;
      gradientHistogram[Math.min(255, Math.round(magnitude / maximumGradient * 255))] += 1;
    }
  }
  const normalGradientP90 = percentileFromHistogram(gradientHistogram, 0.9, maximumGradient);
  // A fixed lower bound prevents two-level checker/JPEG noise (whose central
  // differences cancel over most pixels) from making a few boundary samples
  // define an almost vertical normal field.
  const gradientNormalizer = Math.max(normalGradientP90, 0.25);
  const surfaceSignalConfidence = THREE.MathUtils.clamp(deviation / 0.012, 0, 1);
  const fineNormalizer = Math.max(fineDeviation * 2.8, 0.006);
  const mediumNormalizer = Math.max(mediumDeviation * 2.8, 0.006);
  const coarseNormalizer = Math.max(coarseDeviation * 2.8, 0.006);
  let gradientSum = 0;
  let slopeSquaredSum = 0;
  let roughnessSum = 0;
  let roughnessSquaredSum = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const dx = THREE.MathUtils.clamp(
        (heightAt(x + 1, y) - heightAt(x - 1, y)) / gradientNormalizer
          * strength * 0.9 * surfaceSignalConfidence,
        -3,
        3,
      );
      const dy = THREE.MathUtils.clamp(
        (heightAt(x, y + 1) - heightAt(x, y - 1)) / gradientNormalizer
          * strength * 0.9 * surfaceSignalConfidence,
        -3,
        3,
      );
      const length = Math.hypot(dx, dy, 1);
      normalRgba[offset] = Math.round(((-dx / length) * 0.5 + 0.5) * 255);
      normalRgba[offset + 1] = Math.round(((dy / length) * 0.5 + 0.5) * 255);
      normalRgba[offset + 2] = Math.round(1 / length * 255);
      normalRgba[offset + 3] = 255;
      const gradient = Math.min(1, gradientMagnitudes[index]! / gradientNormalizer) * surfaceSignalConfidence;
      gradientSum += gradient;
      slopeSquaredSum += dx * dx + dy * dy;
      const localStructure = THREE.MathUtils.clamp(
        Math.abs(fineBand[index]!) / fineNormalizer * 0.5
          + Math.abs(mediumBand[index]!) / mediumNormalizer * 0.32
          + Math.abs(coarseBand[index]!) / coarseNormalizer * 0.18,
        0,
        1,
      ) * surfaceSignalConfidence;
      const roughnessSignal = gradient * 0.52 + localStructure * 0.48;
      const roughness = Math.round(THREE.MathUtils.lerp(184, 255, roughnessSignal));
      roughnessRgba.set([roughness, roughness, roughness, 255], offset);
      const normalizedRoughness = roughness / 255;
      roughnessSum += normalizedRoughness;
      roughnessSquaredSum += normalizedRoughness * normalizedRoughness;
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
  const normalSlopeRms = Math.sqrt(slopeSquaredSum / count);
  const meanRoughness = roughnessSum / count;
  const roughnessDeviation = Math.sqrt(Math.max(0, roughnessSquaredSum / count - meanRoughness * meanRoughness));
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
      normalGradientP90,
      normalSlopeRms,
      roughnessDeviation,
      surfaceSignalConfidence,
    },
  };
}

/**
 * Fails closed when a claimed crushed-stone or porous reference is actually
 * flat, single-scale, periodic, or too weak to support derived physical maps.
 * This gate evaluates evidence in the admitted photograph; it does not claim
 * measured millimetre height or material identity from one image.
 */
export function auditReferenceSurfaceEvidence(
  analysis: ReferenceSurfaceAnalysis,
  expectation: ReferenceSurfaceEvidenceAudit['expectation'] = 'irregular-granular',
): ReferenceSurfaceEvidenceAudit {
  const metrics = analysis.metrics;
  const definitions = [
    { id: 'signal', measured: metrics.surfaceSignalConfidence, pass: metrics.surfaceSignalConfidence >= 0.65, score: metrics.surfaceSignalConfidence, threshold: '>=0.65' },
    { id: 'multiscale', measured: metrics.multiScaleBalance, pass: metrics.multiScaleBalance >= 2 / 3, score: metrics.multiScaleBalance, threshold: '>=0.667' },
    { id: 'irregularity', measured: metrics.irregularity, pass: metrics.irregularity >= 0.65, score: metrics.irregularity, threshold: '>=0.65' },
    { id: 'aperiodic', measured: metrics.periodicity, pass: metrics.periodicity <= 0.65, score: 1 - metrics.periodicity, threshold: '<=0.65' },
    { id: 'normal-response', measured: metrics.normalSlopeRms, pass: metrics.normalSlopeRms >= 0.15 && metrics.normalSlopeRms <= 1.8, score: THREE.MathUtils.clamp(metrics.normalSlopeRms / 0.6, 0, 1), threshold: '0.15..1.8' },
    { id: 'roughness-variation', measured: metrics.roughnessDeviation, pass: metrics.roughnessDeviation >= 0.015, score: THREE.MathUtils.clamp(metrics.roughnessDeviation / 0.05, 0, 1), threshold: '>=0.015' },
  ];
  const checks = definitions.map((check) => ({ ...check, score: check.score * 100 }));
  const blockers = checks.filter((check) => !check.pass)
    .map((check) => `${check.id} ${check.measured.toFixed(4)} does not satisfy ${check.threshold}`);
  return {
    schema: 'morphloom.reference-surface-evidence/0.1',
    expectation,
    pass: blockers.length === 0,
    score: checks.reduce((sum, check) => sum + check.score, 0) / checks.length,
    checks,
    blockers,
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
    method: 'image-multiscale-height-v3',
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
