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
}

export interface MaterialFeatures {
  meanRgb: [number, number, number];
  meanLuma: number;
  lumaVariance: number;
  horizontalGradient: number;
  verticalGradient: number;
  anisotropyProxy: number;
  foregroundCoverage: number;
}

export type MaterialMismatch =
  | 'wrong-base-color'
  | 'wrong-exposure-or-value'
  | 'wrong-roughness-or-microstructure'
  | 'wrong-anisotropy'
  | 'highlight-response-too-flat'
  | 'highlight-response-too-sharp'
  | 'missing-environment-response';

export interface MaterialComparisonResult {
  method: 'material-region-v1';
  reference: MaterialFeatures;
  render: MaterialFeatures;
  deltaE76: number;
  scores: {
    baseColor: number;
    meanLuma: number;
    microstructure: number;
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
    }
  }
  const horizontalGradient = horizontal / Math.max(1, horizontalCount);
  const verticalGradient = vertical / Math.max(1, verticalCount);
  return {
    meanRgb,
    meanLuma,
    lumaVariance,
    horizontalGradient,
    verticalGradient,
    anisotropyProxy: Math.min(4, Math.max(horizontalGradient, verticalGradient) / Math.max(1e-6, Math.min(horizontalGradient, verticalGradient))),
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
    microstructure: similarity(reference.lumaVariance, render.lumaVariance, 0.12),
    directionalResponse: similarity(reference.anisotropyProxy, render.anisotropyProxy, 2),
    overall: 0,
  };
  scores.overall = scores.baseColor * 0.4 + scores.meanLuma * 0.2 + scores.microstructure * 0.25 + scores.directionalResponse * 0.15;
  const mismatches: MaterialMismatch[] = [];
  if (colorDistance > 20) mismatches.push('wrong-base-color');
  if (scores.meanLuma < 0.72) mismatches.push('wrong-exposure-or-value');
  if (scores.microstructure < 0.62) mismatches.push('wrong-roughness-or-microstructure');
  if ((expected?.anisotropy ?? 0) > 0.5 && render.anisotropyProxy < 1.25) mismatches.push('wrong-anisotropy');
  if ((expected?.roughness ?? 0.5) < 0.2 && render.lumaVariance < 0.003) mismatches.push('highlight-response-too-flat');
  if ((expected?.roughness ?? 0.5) > 0.8 && render.lumaVariance > 0.08) mismatches.push('highlight-response-too-sharp');
  if (expected?.family && ['metal', 'glass', 'gemstone'].includes(expected.family) && render.lumaVariance < 0.002) {
    mismatches.push('missing-environment-response');
  }
  const uniqueMismatches = [...new Set(mismatches)];
  const passed = scores.overall >= 0.7 && !uniqueMismatches.includes('wrong-base-color') && !uniqueMismatches.includes('missing-environment-response');
  return {
    method: 'material-region-v1',
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
