export interface ThinTerminal {
  x: number;
  y: number;
  normalizedX: number;
  normalizedY: number;
}

export interface ThinTerminalExtraction {
  status: 'extracted' | 'blocked';
  terminals: ThinTerminal[];
  foregroundBounds: [number, number, number, number];
  regionTop: number;
  skeletonPixels: number;
  blockers: string[];
}

export interface ThinTerminalOptions {
  regionTopFraction?: number;
  terminalStartFraction?: number;
  minimumTerminals?: number;
  maximumTerminals?: number;
  maximumIterations?: number;
}

const MAX_PIXELS = 4_194_304;

function bounds(mask: Uint8Array, width: number, height: number): [number, number, number, number] {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (!mask[y * width + x]) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (maxX < minX) throw new Error('Thin-terminal silhouette contains no foreground.');
  return [minX, minY, maxX + 1, maxY + 1];
}

function neighbourValues(mask: Uint8Array, width: number, index: number): number[] {
  return [
    mask[index - width]!, mask[index - width + 1]!, mask[index + 1]!, mask[index + width + 1]!,
    mask[index + width]!, mask[index + width - 1]!, mask[index - 1]!, mask[index - width - 1]!,
  ];
}

function transitions(neighbours: number[]): number {
  let count = 0;
  for (let index = 0; index < neighbours.length; index += 1) {
    if (neighbours[index] === 0 && neighbours[(index + 1) % neighbours.length] !== 0) count += 1;
  }
  return count;
}

/** Bounded Zhang–Suen thinning over an evidence-selected lower/branch region. */
function thin(source: Uint8Array, width: number, height: number, maximumIterations: number): Uint8Array {
  const mask = source.slice();
  const remove = new Uint8Array(mask.length);
  for (let iteration = 0; iteration < maximumIterations; iteration += 1) {
    let changed = false;
    for (const phase of [0, 1]) {
      remove.fill(0);
      for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (!mask[index]) continue;
        const n = neighbourValues(mask, width, index);
        const count = n.reduce((sum, value) => sum + Number(value !== 0), 0);
        if (count < 2 || count > 6 || transitions(n) !== 1) continue;
        const phasePass = phase === 0
          ? n[0]! * n[2]! * n[4]! === 0 && n[2]! * n[4]! * n[6]! === 0
          : n[0]! * n[2]! * n[6]! === 0 && n[0]! * n[4]! * n[6]! === 0;
        if (phasePass) remove[index] = 1;
      }
      for (let index = 0; index < mask.length; index += 1) {
        if (!remove[index]) continue;
        mask[index] = 0;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return mask;
}

export function extractThinTerminals(
  source: Uint8Array,
  width: number,
  height: number,
  options: ThinTerminalOptions = {},
): ThinTerminalExtraction {
  if (!(source instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 8 || height < 8 || width * height !== source.length || source.length > MAX_PIXELS) {
    throw new Error('Thin-terminal silhouette dimensions are unsafe or inconsistent.');
  }
  const regionTopFraction = options.regionTopFraction ?? 0.25;
  const terminalStartFraction = options.terminalStartFraction ?? 0.62;
  const minimumTerminals = options.minimumTerminals ?? 2;
  const maximumTerminals = options.maximumTerminals ?? 12;
  const maximumIterations = options.maximumIterations ?? 128;
  if (!Number.isFinite(regionTopFraction) || regionTopFraction < 0 || regionTopFraction > 0.8
    || !Number.isFinite(terminalStartFraction) || terminalStartFraction <= regionTopFraction || terminalStartFraction > 1
    || !Number.isInteger(minimumTerminals) || minimumTerminals < 1 || minimumTerminals > 32
    || !Number.isInteger(maximumTerminals) || maximumTerminals < minimumTerminals || maximumTerminals > 64
    || !Number.isInteger(maximumIterations) || maximumIterations < 1 || maximumIterations > 512) {
    throw new Error('Thin-terminal extraction options are unsafe.');
  }
  const foregroundBounds = bounds(source, width, height);
  const objectHeight = foregroundBounds[3] - foregroundBounds[1];
  const regionTop = Math.floor(foregroundBounds[1] + objectHeight * regionTopFraction);
  const terminalStart = foregroundBounds[1] + objectHeight * terminalStartFraction;
  const region = new Uint8Array(source.length);
  for (let y = regionTop; y < foregroundBounds[3]; y += 1) {
    for (let x = foregroundBounds[0]; x < foregroundBounds[2]; x += 1) region[y * width + x] = Number(source[y * width + x] !== 0);
  }
  const skeleton = thin(region, width, height, maximumIterations);
  const raw: Array<{ x: number; y: number }> = [];
  let skeletonPixels = 0;
  for (let y = 1; y < height - 1; y += 1) for (let x = 1; x < width - 1; x += 1) {
    const index = y * width + x;
    if (!skeleton[index]) continue;
    skeletonPixels += 1;
    if (y < terminalStart) continue;
    const degree = neighbourValues(skeleton, width, index).reduce((sum, value) => sum + Number(value !== 0), 0);
    if (degree <= 1) raw.push({ x, y });
  }
  raw.sort((left, right) => right.y - left.y || left.x - right.x);
  const clustered: Array<{ x: number; y: number }> = [];
  for (const point of raw) {
    if (clustered.some((accepted) => Math.hypot(accepted.x - point.x, accepted.y - point.y) <= 4)) continue;
    clustered.push(point);
  }
  const selected = clustered.slice(0, maximumTerminals).sort((left, right) => left.x - right.x || right.y - left.y);
  const terminals = selected.map((point) => ({
    ...point,
    normalizedX: (point.x - foregroundBounds[0]) / Math.max(1, foregroundBounds[2] - foregroundBounds[0] - 1),
    normalizedY: (point.y - foregroundBounds[1]) / Math.max(1, foregroundBounds[3] - foregroundBounds[1] - 1),
  }));
  const blockers = terminals.length < minimumTerminals
    ? [`thin-terminal extraction found ${terminals.length}/${minimumTerminals} required endpoints`]
    : [];
  return { status: blockers.length === 0 ? 'extracted' : 'blocked', terminals, foregroundBounds, regionTop, skeletonPixels, blockers };
}
