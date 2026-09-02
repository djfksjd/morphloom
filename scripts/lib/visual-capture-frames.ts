import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { ComparisonFrame } from '../../src/engine/reference-comparison';

export const TARGET_WIDTH = 512;
export const TARGET_HEIGHT = 256;
const MAX_PIXELS = 16_777_216;
const MAX_CAPTURE_BYTES = 64 * 1024 * 1024;

export interface NormalizedCapture {
  frame: ComparisonFrame;
  bytes: Uint8Array;
  aspect: number;
  threshold: number;
  sourceWidth: number;
  sourceHeight: number;
}

export function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function coherentForeground(mask: Uint8Array, width: number, height: number): Uint8Array {
  const count = width * height;
  const labels = new Int32Array(count);
  const queue = new Int32Array(count);
  let label = 0;
  const components: Array<{ label: number; size: number; bounds: [number, number, number, number] }> = [];
  for (let start = 0; start < count; start += 1) {
    if (!mask[start] || labels[start]) continue;
    label += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    while (head < tail) {
      const pixel = queue[head++];
      const x = pixel % width;
      const y = Math.floor(pixel / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const neighbour = ny * width + nx;
          if (!mask[neighbour] || labels[neighbour]) continue;
          labels[neighbour] = label;
          queue[tail++] = neighbour;
        }
      }
    }
    components.push({ label, size: tail, bounds: [minX, minY, maxX + 1, maxY + 1] });
  }
  const usable = components.filter((component) => {
    const [x0, y0, x1, y1] = component.bounds;
    const touchedBorders = Number(x0 === 0) + Number(y0 === 0) + Number(x1 === width) + Number(y1 === height);
    return component.size >= Math.max(16, count * 0.00003)
      && component.size / Math.max(1, (x1 - x0) * (y1 - y0)) >= 0.015
      && touchedBorders < 2;
  }).sort((a, b) => b.size - a.size);
  const largestSize = usable[0]?.size ?? 0;
  if (largestSize < count * 0.002) throw new Error('Capture has no sufficiently large connected foreground object.');
  const admitted = new Set<number>([usable[0]!.label]);
  let union = [...usable[0]!.bounds] as [number, number, number, number];
  const gapToUnion = ([x0, y0, x1, y1]: [number, number, number, number]) => Math.hypot(
    Math.max(0, union[0] - x1, x0 - union[2]),
    Math.max(0, union[1] - y1, y0 - union[3]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    const tolerance = Math.max(6, Math.max(union[2] - union[0], union[3] - union[1]) * 0.035);
    for (const component of usable) {
      if (admitted.has(component.label) || gapToUnion(component.bounds) > tolerance) continue;
      admitted.add(component.label);
      union = [
        Math.min(union[0], component.bounds[0]), Math.min(union[1], component.bounds[1]),
        Math.max(union[2], component.bounds[2]), Math.max(union[3], component.bounds[3]),
      ];
      changed = true;
    }
  }
  return Uint8Array.from(labels, (value) => Number(admitted.has(value)));
}

function foregroundBounds(mask: Uint8Array, width: number, height: number): [number, number, number, number] {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) throw new Error('Capture foreground is empty.');
  return [minX, minY, maxX + 1, maxY + 1];
}

export function validateCaptureThreshold(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 254) {
    throw new Error(`${label} must be an integer within 1..254.`);
  }
  return value as number;
}

interface DecodedCapture {
  bytes: Uint8Array;
  sourceCanvas: ReturnType<typeof createCanvas>;
  mask: Uint8Array;
  bounds: [number, number, number, number];
  aspect: number;
  threshold: number;
  sourceWidth: number;
  sourceHeight: number;
}

async function decodeCapture(
  path: string,
  expectedAspect?: number,
  forcedThreshold?: number,
): Promise<DecodedCapture> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.size < 1 || metadata.size > MAX_CAPTURE_BYTES) {
    throw new Error(`${basename(path)} exceeds the 64 MB capture budget.`);
  }
  const bytes = new Uint8Array(await readFile(path));
  const image = await loadImage(bytes);
  const count = image.width * image.height;
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_PIXELS) throw new Error(`${basename(path)} exceeds the capture pixel budget.`);
  const sourceCanvas = createCanvas(image.width, image.height);
  const sourceContext = sourceCanvas.getContext('2d');
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, image.width, image.height).data;
  let transparent = 0;
  for (let pixel = 0; pixel < count; pixel += 1) transparent += Number(pixels[pixel * 4 + 3] <= 32);
  const usesAlpha = transparent > count * 0.01;
  const corners = [[0, 0], [image.width - 1, 0], [0, image.height - 1], [image.width - 1, image.height - 1]];
  const background = [0, 1, 2].map((channel) => Math.round(corners.reduce((sum, [x, y]) => (
    sum + pixels[(y * image.width + x) * 4 + channel]
  ), 0) / corners.length));
  const thresholdOverride = validateCaptureThreshold(forcedThreshold, `${basename(path)} threshold`);
  const thresholds = usesAlpha ? [32] : thresholdOverride ? [thresholdOverride] : [20, 24, 32, 40, 48, 64, 80];
  const candidates = thresholds.flatMap((threshold) => {
    try {
      const rawMask = new Uint8Array(count);
      for (let pixel = 0; pixel < count; pixel += 1) {
        const offset = pixel * 4;
        const distance = Math.abs(pixels[offset] - background[0])
          + Math.abs(pixels[offset + 1] - background[1])
          + Math.abs(pixels[offset + 2] - background[2]);
        rawMask[pixel] = Number(usesAlpha ? pixels[offset + 3] > threshold : distance > threshold);
      }
      const candidateMask = coherentForeground(rawMask, image.width, image.height);
      const bounds = foregroundBounds(candidateMask, image.width, image.height);
      const aspect = (bounds[2] - bounds[0]) / Math.max(1, bounds[3] - bounds[1]);
      const filled = candidateMask.reduce((sum, value) => sum + value, 0);
      const boxArea = (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]);
      const fill = filled / Math.max(1, boxArea);
      const aspectPenalty = expectedAspect ? Math.abs(Math.log(aspect / expectedAspect)) : 0;
      const fillPenalty = fill < 0.08 || fill > 0.82 ? 2 : 0;
      return [{ mask: candidateMask, bounds, aspect, threshold, rank: aspectPenalty + fillPenalty }];
    } catch {
      return [];
    }
  }).sort((a, b) => a.rank - b.rank);
  if (candidates.length === 0) throw new Error(`${basename(path)} foreground segmentation failed.`);
  const { mask, bounds, aspect, threshold } = candidates[0]!;
  return { bytes, sourceCanvas, mask, bounds, aspect, threshold, sourceWidth: image.width, sourceHeight: image.height };
}

function resizeMask(
  mask: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  source: [number, number, number, number],
  target: [number, number, number, number],
): Uint8Array {
  const maskCanvas = createCanvas(sourceWidth, sourceHeight);
  const maskContext = maskCanvas.getContext('2d');
  const maskImage = maskContext.createImageData(sourceWidth, sourceHeight);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const value = mask[pixel] ? 255 : 0;
    const offset = pixel * 4;
    maskImage.data[offset] = value;
    maskImage.data[offset + 1] = value;
    maskImage.data[offset + 2] = value;
    maskImage.data[offset + 3] = 255;
  }
  maskContext.putImageData(maskImage, 0, 0);
  const normalizedMaskCanvas = createCanvas(TARGET_WIDTH, TARGET_HEIGHT);
  const normalizedMaskContext = normalizedMaskCanvas.getContext('2d');
  normalizedMaskContext.imageSmoothingEnabled = false;
  normalizedMaskContext.drawImage(maskCanvas, ...source, ...target);
  const normalizedMaskPixels = normalizedMaskContext.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT).data;
  const normalizedMask = new Uint8Array(TARGET_WIDTH * TARGET_HEIGHT);
  for (let pixel = 0; pixel < normalizedMask.length; pixel += 1) normalizedMask[pixel] = Number(normalizedMaskPixels[pixel * 4] > 127);
  return normalizedMask;
}

export async function normalizedFrame(
  path: string,
  expectedAspect?: number,
  forcedThreshold?: number,
): Promise<NormalizedCapture> {
  const decoded = await decodeCapture(path, expectedAspect, forcedThreshold);
  const { bytes, sourceCanvas, mask, bounds: [x0, y0, x1, y1], aspect, threshold, sourceWidth, sourceHeight } = decoded;
  const padding = 12;
  const scale = Math.min((TARGET_WIDTH - padding * 2) / (x1 - x0), (TARGET_HEIGHT - padding * 2) / (y1 - y0));
  const drawWidth = (x1 - x0) * scale;
  const drawHeight = (y1 - y0) * scale;
  const drawX = (TARGET_WIDTH - drawWidth) * 0.5;
  const drawY = (TARGET_HEIGHT - drawHeight) * 0.5;
  const target = createCanvas(TARGET_WIDTH, TARGET_HEIGHT);
  const targetContext = target.getContext('2d');
  targetContext.fillStyle = '#ffffff';
  targetContext.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  targetContext.drawImage(sourceCanvas, x0, y0, x1 - x0, y1 - y0, drawX, drawY, drawWidth, drawHeight);
  const normalizedMask = resizeMask(mask, sourceWidth, sourceHeight,
    [x0, y0, x1 - x0, y1 - y0], [drawX, drawY, drawWidth, drawHeight]);
  return {
    frame: {
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      rgba: targetContext.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT).data,
      mask: normalizedMask,
    },
    bytes,
    aspect,
    threshold,
    sourceWidth,
    sourceHeight,
  };
}

/**
 * Resizes the complete source canvas without independently fitting its foreground.
 * Use this for calibrated same-camera comparisons so translation, scale, and
 * framing errors remain measurable instead of being normalized away.
 */
export async function lockedCanvasFrame(path: string, forcedThreshold?: number): Promise<NormalizedCapture> {
  const decoded = await decodeCapture(path, undefined, forcedThreshold);
  const { bytes, sourceCanvas, mask, aspect, threshold, sourceWidth, sourceHeight } = decoded;
  const target = createCanvas(TARGET_WIDTH, TARGET_HEIGHT);
  const targetContext = target.getContext('2d');
  targetContext.fillStyle = '#ffffff';
  targetContext.fillRect(0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  targetContext.drawImage(sourceCanvas, 0, 0, sourceWidth, sourceHeight, 0, 0, TARGET_WIDTH, TARGET_HEIGHT);
  const normalizedMask = resizeMask(mask, sourceWidth, sourceHeight,
    [0, 0, sourceWidth, sourceHeight], [0, 0, TARGET_WIDTH, TARGET_HEIGHT]);
  return {
    frame: {
      width: TARGET_WIDTH,
      height: TARGET_HEIGHT,
      rgba: targetContext.getImageData(0, 0, TARGET_WIDTH, TARGET_HEIGHT).data,
      mask: normalizedMask,
    },
    bytes,
    aspect,
    threshold,
    sourceWidth,
    sourceHeight,
  };
}
