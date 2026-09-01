/**
 * Deterministic material-region comparison adapted from img2threejs.
 * Copyright 2026 hoainho. Licensed under Apache-2.0.
 * Source: https://github.com/img2threejs/img2threejs/blob/9fbd0ca5bbcc3b13bebe712745d6784d33db0b85/forge/stage4_review/material_comparator.py
 * Modified for Morphloom: in-memory RGBA frames, CIE Lab distance, configurable
 * bounded sampling, and typed mismatch evidence suitable for the fidelity gate.
 */
import type { ComparisonFrame } from './reference-comparison';

export interface MaterialExpectation {
  family?: 'metal' | 'glass' | 'gemstone' | 'plastic' | 'fabric' | 'wood' | 'coating' | 'other';
  roughness?: number;
  anisotropy?: number;
  surfaceCharacter?: 'smooth' | 'directional' | 'granular' | 'woven' | 'porous';
}

export interface MaterialFeatures {
  meanRgb: [number, number, number];
  meanLuma: number;
  lumaVariance: number;
  horizontalGradient: number;
  verticalGradient: number;
  anisotropyProxy: number;
  fineContrast: number;
  coarseContrast: number;
  gradientEntropy: number;
  periodicity: number;
  irregularity: number;
  gradientHistogram: number[];
  foregroundCoverage: number;
}

export type MaterialMismatch =
  | 'wrong-base-color'
  | 'wrong-exposure-or-value'
  | 'wrong-roughness-or-microstructure'
  | 'wrong-surface-scale'
  | 'surface-too-regular'
  | 'wrong-anisotropy'
  | 'highlight-response-too-flat'
  | 'highlight-response-too-sharp'
  | 'missing-environment-response';

export interface MaterialComparisonResult {
  method: 'material-region-v2';
  reference: MaterialFeatures;
  render: MaterialFeatures;
  deltaE76: number;
  scores: {
    baseColor: number;
    meanLuma: number;
    microstructure: number;
    surfaceScale: number;
    irregularity: number;
    directionalResponse: number;
    overall: number;
  };
  mismatches: MaterialMismatch[];
  passed: boolean;
  nextAction: 'continue' | 'refine-material';
  limitation: string;
}

const MAX_FRAME_PIXELS = 16_777_216;
const MIN_GRID = 8;
const MAX_GRID = 192;

function validateFrame(frame: ComparisonFrame, label: string): void {
  const count = frame.width * frame.height;
  if (!Number.isInteger(frame.width) || !Number.isInteger(frame.height) || frame.width < 1 || frame.height < 1
    || !Number.isSafeInteger(count) || count > MAX_FRAME_PIXELS || frame.rgba.length !== count * 4) {
    throw new Error(`${label} material frame is invalid or exceeds the pixel budget.`);
  }
  if (frame.mask && frame.mask.length !== count) throw new Error(`${label} material mask length is invalid.`);
}

function foreground(frame: ComparisonFrame, index: number): boolean {
  if (frame.mask) return frame.mask[index] !== 0;
  const offset = index * 4;
  if (frame.rgba[offset + 3] <= 16) return false;
  const background = frame.backgroundRgb ?? [255, 255, 255];
  return Math.abs(frame.rgba[offset] - background[0])
    + Math.abs(frame.rgba[offset + 1] - background[1])
    + Math.abs(frame.rgba[offset + 2] - background[2]) > 36;
}

function luma(rgb: readonly [number, number, number]): number {
  return (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) / 255;
}

function histogramSimilarity(first: readonly number[], second: readonly number[]): number {
  let difference = 0;
  for (let index = 0; index < Math.max(first.length, second.length); index += 1) {
    difference += Math.abs((first[index] ?? 0) - (second[index] ?? 0));
  }
  return Math.max(0, 1 - difference * 0.5);
}

function sampleFeatures(frame: ComparisonFrame, grid: number): MaterialFeatures {
  validateFrame(frame, 'Input');
  if (!Number.isInteger(grid) || grid < MIN_GRID || grid > MAX_GRID) throw new Error(`Material grid must be ${MIN_GRID}..${MAX_GRID}.`);
  const samples: Array<[number, number, number]> = [];
  const selected: boolean[] = [];
  for (let gy = 0; gy < grid; gy += 1) {
    const y = Math.min(frame.height - 1, Math.floor((gy + 0.5) * frame.height / grid));
    for (let gx = 0; gx < grid; gx += 1) {
      const x = Math.min(frame.width - 1, Math.floor((gx + 0.5) * frame.width / grid));
      const pixel = y * frame.width + x;
      const offset = pixel * 4;
      samples.push([frame.rgba[offset], frame.rgba[offset + 1], frame.rgba[offset + 2]]);
      selected.push(foreground(frame, pixel));
    }
  }
  const selectedCount = selected.reduce((sum, item) => sum + Number(item), 0);
  const useForeground = selectedCount > 0;
  const kept = samples.filter((_, index) => !useForeground || selected[index]);
  const meanRgb: [number, number, number] = [0, 1, 2].map((channel) => (
    kept.reduce((sum, value) => sum + value[channel], 0) / kept.length
  )) as [number, number, number];
  const luminances = samples.map(luma);
  const keptLuminances = luminances.filter((_, index) => !useForeground || selected[index]);
  const meanLuma = keptLuminances.reduce((sum, value) => sum + value, 0) / keptLuminances.length;
  const lumaVariance = keptLuminances.reduce((sum, value) => sum + (value - meanLuma) ** 2, 0) / keptLuminances.length;
  let horizontal = 0;
  let vertical = 0;
  let horizontalCount = 0;
  let verticalCount = 0;
  const gradientHistogram = new Array<number>(8).fill(0);
  const contrastAt = (radius: number): number => {
    let contrast = 0;
    let compared = 0;
    for (let y = radius; y < grid - radius; y += 1) {
      for (let x = radius; x < grid - radius; x += 1) {
        const index = y * grid + x;
        if (useForeground && !selected[index]) continue;
        const neighbours = [index - radius, index + radius, index - radius * grid, index + radius * grid];
        if (useForeground && neighbours.some((neighbour) => !selected[neighbour])) continue;
        const mean = neighbours.reduce((sum, neighbour) => sum + luminances[neighbour]!, 0) / neighbours.length;
        contrast += Math.abs(luminances[index]! - mean);
        compared += 1;
      }
    }
    return contrast / Math.max(1, compared);
  };
  for (let y = 0; y < grid; y += 1) {
    for (let x = 0; x < grid; x += 1) {
      const index = y * grid + x;
      if (x > 0 && (!useForeground || (selected[index] && selected[index - 1]))) {
        horizontal += Math.abs(luminances[index] - luminances[index - 1]);
        horizontalCount += 1;
      }
      if (y > 0 && (!useForeground || (selected[index] && selected[index - grid]))) {
        vertical += Math.abs(luminances[index] - luminances[index - grid]);
        verticalCount += 1;
      }
      if (x > 0 && x < grid - 1 && y > 0 && y < grid - 1
        && (!useForeground || (selected[index] && selected[index - 1] && selected[index + 1]
          && selected[index - grid] && selected[index + grid]))) {
        const gx = luminances[index + 1]! - luminances[index - 1]!;
        const gy = luminances[index + grid]! - luminances[index - grid]!;
        const magnitude = Math.hypot(gx, gy);
        const angle = (Math.atan2(gy, gx) + Math.PI) % Math.PI;
        const bin = Math.min(7, Math.floor(angle / Math.PI * 8));
        gradientHistogram[bin] += magnitude;
      }
    }
  }
  const horizontalGradient = horizontal / Math.max(1, horizontalCount);
  const verticalGradient = vertical / Math.max(1, verticalCount);
  const histogramTotal = gradientHistogram.reduce((sum, value) => sum + value, 0);
  if (histogramTotal > 1e-12) {
    for (let index = 0; index < gradientHistogram.length; index += 1) gradientHistogram[index] /= histogramTotal;
  }
  let gradientEntropy = 0;
  for (const value of gradientHistogram) if (value > 0) gradientEntropy -= value * Math.log2(value);
  gradientEntropy /= Math.log2(gradientHistogram.length);
  const centered = luminances.map((value) => value - meanLuma);
  let periodicity = 0;
  const maximumLag = Math.max(2, Math.min(16, Math.floor(grid / 3)));
  for (let lag = 2; lag <= maximumLag; lag += 1) {
    for (const verticalLag of [false, true]) {
      let dot = 0;
      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let y = 0; y < grid - (verticalLag ? lag : 0); y += 1) {
        for (let x = 0; x < grid - (verticalLag ? 0 : lag); x += 1) {
          const first = y * grid + x;
          const second = (y + (verticalLag ? lag : 0)) * grid + x + (verticalLag ? 0 : lag);
          if (useForeground && (!selected[first] || !selected[second])) continue;
          dot += centered[first]! * centered[second]!;
          leftEnergy += centered[first]! ** 2;
          rightEnergy += centered[second]! ** 2;
        }
      }
      if (leftEnergy > 1e-12 && rightEnergy > 1e-12) {
        periodicity = Math.max(periodicity, Math.abs(dot / Math.sqrt(leftEnergy * rightEnergy)));
      }
    }
  }
  const fineContrast = contrastAt(1);
  const coarseContrast = contrastAt(Math.max(2, Math.round(grid / 12)));
  return {
    meanRgb,
    meanLuma,
    lumaVariance,
    horizontalGradient,
    verticalGradient,
    anisotropyProxy: Math.min(4, Math.max(horizontalGradient, verticalGradient) / Math.max(1e-6, Math.min(horizontalGradient, verticalGradient))),
    fineContrast,
    coarseContrast,
    gradientEntropy,
    periodicity,
    irregularity: Math.max(0, Math.min(1, gradientEntropy * 0.58 + (1 - periodicity) * 0.42)),
    gradientHistogram,
    foregroundCoverage: selectedCount / selected.length,
  };
}

function srgbToLinear(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

function rgbToLab(rgb: readonly [number, number, number]): [number, number, number] {
  const [red, green, blue] = rgb.map(srgbToLinear);
  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047;
  const y = red * 0.2126 + green * 0.7152 + blue * 0.0722;
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883;
  const f = (value: number) => value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116;
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

function deltaE76(first: readonly [number, number, number], second: readonly [number, number, number]): number {
  const a = rgbToLab(first);
  const b = rgbToLab(second);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function similarity(first: number, second: number, scale: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(first - second) / scale));
}

export function compareMaterialFrames(
  referenceFrame: ComparisonFrame,
  renderFrame: ComparisonFrame,
  expected?: MaterialExpectation,
  grid = 48,
): MaterialComparisonResult {
  validateFrame(referenceFrame, 'Reference');
  validateFrame(renderFrame, 'Render');
  const reference = sampleFeatures(referenceFrame, grid);
  const render = sampleFeatures(renderFrame, grid);
  const colorDistance = deltaE76(reference.meanRgb, render.meanRgb);
  const scores = {
    baseColor: similarity(colorDistance, 0, 50),
    meanLuma: similarity(reference.meanLuma, render.meanLuma, 0.45),
    microstructure: (
      similarity(reference.lumaVariance, render.lumaVariance, 0.12) * 0.35
      + similarity(reference.fineContrast, render.fineContrast, 0.18) * 0.4
      + histogramSimilarity(reference.gradientHistogram, render.gradientHistogram) * 0.25
    ),
    surfaceScale: (
      similarity(reference.coarseContrast, render.coarseContrast, 0.2) * 0.35
      + similarity(reference.coarseContrast / Math.max(1e-5, reference.fineContrast), render.coarseContrast / Math.max(1e-5, render.fineContrast), 2) * 0.25
      + similarity(reference.periodicity, render.periodicity, 0.65) * 0.25
      + similarity(reference.gradientEntropy, render.gradientEntropy, 0.75) * 0.15
    ),
    irregularity: similarity(reference.irregularity, render.irregularity, 0.5),
    directionalResponse: (
      similarity(reference.anisotropyProxy, render.anisotropyProxy, 2) * 0.5
      + histogramSimilarity(reference.gradientHistogram, render.gradientHistogram) * 0.5
    ),
    overall: 0,
  };
  scores.overall = scores.baseColor * 0.3 + scores.meanLuma * 0.15 + scores.microstructure * 0.2
    + scores.surfaceScale * 0.15 + scores.irregularity * 0.1 + scores.directionalResponse * 0.1;
  const mismatches: MaterialMismatch[] = [];
  if (colorDistance > 20) mismatches.push('wrong-base-color');
  if (scores.meanLuma < 0.72) mismatches.push('wrong-exposure-or-value');
  if (scores.microstructure < 0.62) mismatches.push('wrong-roughness-or-microstructure');
  if (scores.surfaceScale < 0.62) mismatches.push('wrong-surface-scale');
  if (expected?.surfaceCharacter === 'granular'
    && (render.irregularity < 0.45 || render.irregularity < reference.irregularity - 0.16)) {
    mismatches.push('surface-too-regular');
  }
  if ((expected?.anisotropy ?? 0) > 0.5 && render.anisotropyProxy < 1.25) mismatches.push('wrong-anisotropy');
  if ((expected?.roughness ?? 0.5) < 0.2 && render.lumaVariance < 0.003) mismatches.push('highlight-response-too-flat');
  if ((expected?.roughness ?? 0.5) > 0.8 && render.lumaVariance > 0.08) mismatches.push('highlight-response-too-sharp');
  if (expected?.family && ['metal', 'glass', 'gemstone'].includes(expected.family) && render.lumaVariance < 0.002) {
    mismatches.push('missing-environment-response');
  }
  const uniqueMismatches = [...new Set(mismatches)];
  const passed = scores.overall >= 0.72
    && !uniqueMismatches.includes('wrong-base-color')
    && !uniqueMismatches.includes('missing-environment-response')
    && !uniqueMismatches.includes('wrong-surface-scale')
    && !uniqueMismatches.includes('surface-too-regular');
  return {
    method: 'material-region-v2',
    reference,
    render,
    deltaE76: colorDistance,
    scores,
    mismatches: uniqueMismatches,
    passed,
    nextAction: passed && uniqueMismatches.length === 0 ? 'continue' : 'refine-material',
    limitation: 'Image metrics constrain appearance but cannot uniquely identify physical material parameters without calibrated lighting.',
  };
}
