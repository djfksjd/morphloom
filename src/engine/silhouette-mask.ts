export interface PreparedSilhouetteMask {
  rows: string[];
  width: number;
  height: number;
  sourceBounds: [number, number, number, number];
  sourceForegroundPixels: number;
  filledHolePixels: number;
  outputForegroundPixels: number;
  coverageThreshold: number;
}

export interface PrepareSilhouetteMaskOptions {
  maximumDimension?: number;
  paddingPixels?: number;
  coverageThreshold?: number;
}

const MAX_SOURCE_PIXELS = 16_777_216;
const MAX_OUTPUT_DIMENSION = 256;

function checkedDimensions(mask: Uint8Array, width: number, height: number): void {
  if (!(mask instanceof Uint8Array) || !Number.isInteger(width) || !Number.isInteger(height)
    || width < 4 || height < 4 || width * height !== mask.length || mask.length > MAX_SOURCE_PIXELS) {
    throw new Error('Silhouette source mask dimensions are unsafe or inconsistent.');
  }
}

export function solidifySilhouetteMask(mask: Uint8Array, width: number, height: number): { mask: Uint8Array; filled: number } {
  checkedDimensions(mask, width, height);
  const exterior = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  let head = 0;
  let tail = 0;
  const enqueue = (index: number): void => {
    if (mask[index] !== 0 || exterior[index] !== 0) return;
    exterior[index] = 1;
    queue[tail] = index;
    tail += 1;
  };
  for (let x = 0; x < width; x += 1) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head]!;
    head += 1;
    const x = index % width;
    const y = Math.floor(index / width);
    if (x > 0) enqueue(index - 1);
    if (x + 1 < width) enqueue(index + 1);
    if (y > 0) enqueue(index - width);
    if (y + 1 < height) enqueue(index + width);
  }
  const solid = new Uint8Array(mask.length);
  let filled = 0;
  for (let index = 0; index < mask.length; index += 1) {
    const value = mask[index] !== 0 || exterior[index] === 0 ? 1 : 0;
    solid[index] = value;
    if (value && mask[index] === 0) filled += 1;
  }
  return { mask: solid, filled };
}

function foregroundBounds(mask: Uint8Array, width: number, height: number): [number, number, number, number] {
  let minimumX = width;
  let minimumY = height;
  let maximumX = -1;
  let maximumY = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (mask[y * width + x] === 0) continue;
    minimumX = Math.min(minimumX, x);
    minimumY = Math.min(minimumY, y);
    maximumX = Math.max(maximumX, x);
    maximumY = Math.max(maximumY, y);
  }
  if (maximumX < minimumX || maximumY < minimumY) throw new Error('Silhouette source mask contains no foreground.');
  return [minimumX, minimumY, maximumX + 1, maximumY + 1];
}

export function prepareVisualHullMask(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  options: PrepareSilhouetteMaskOptions = {},
): PreparedSilhouetteMask {
  checkedDimensions(source, sourceWidth, sourceHeight);
  const maximumDimension = options.maximumDimension ?? 192;
  const paddingPixels = options.paddingPixels ?? 1;
  const coverageThreshold = options.coverageThreshold ?? 0.25;
  if (!Number.isInteger(maximumDimension) || maximumDimension < 8 || maximumDimension > MAX_OUTPUT_DIMENSION
    || !Number.isInteger(paddingPixels) || paddingPixels < 0 || paddingPixels > 8 || paddingPixels * 2 + 4 > maximumDimension
    || !Number.isFinite(coverageThreshold) || coverageThreshold <= 0 || coverageThreshold > 1) {
    throw new Error('Silhouette output options are unsafe.');
  }
  const sourceForegroundPixels = source.reduce((sum, value) => sum + Number(value !== 0), 0);
  const solid = solidifySilhouetteMask(source, sourceWidth, sourceHeight);
  const sourceBounds = foregroundBounds(solid.mask, sourceWidth, sourceHeight);
  const cropWidth = sourceBounds[2] - sourceBounds[0];
  const cropHeight = sourceBounds[3] - sourceBounds[1];
  const available = maximumDimension - paddingPixels * 2;
  const scale = available / Math.max(cropWidth, cropHeight);
  const innerWidth = Math.max(4, Math.round(cropWidth * scale));
  const innerHeight = Math.max(4, Math.round(cropHeight * scale));
  const width = innerWidth + paddingPixels * 2;
  const height = innerHeight + paddingPixels * 2;
  const output = new Uint8Array(width * height);
  for (let targetY = 0; targetY < innerHeight; targetY += 1) {
    const sourceY0 = sourceBounds[1] + targetY * cropHeight / innerHeight;
    const sourceY1 = sourceBounds[1] + (targetY + 1) * cropHeight / innerHeight;
    const minimumY = Math.floor(sourceY0);
    const maximumY = Math.max(minimumY + 1, Math.ceil(sourceY1));
    for (let targetX = 0; targetX < innerWidth; targetX += 1) {
      const sourceX0 = sourceBounds[0] + targetX * cropWidth / innerWidth;
      const sourceX1 = sourceBounds[0] + (targetX + 1) * cropWidth / innerWidth;
      const minimumX = Math.floor(sourceX0);
      const maximumX = Math.max(minimumX + 1, Math.ceil(sourceX1));
      let selected = 0;
      let sampled = 0;
      for (let y = minimumY; y < maximumY && y < sourceBounds[3]; y += 1) {
        for (let x = minimumX; x < maximumX && x < sourceBounds[2]; x += 1) {
          selected += Number(solid.mask[y * sourceWidth + x] !== 0);
          sampled += 1;
        }
      }
      output[(targetY + paddingPixels) * width + targetX + paddingPixels] = Number(selected / Math.max(1, sampled) >= coverageThreshold);
    }
  }
  const outputForegroundPixels = output.reduce((sum, value) => sum + value, 0);
  if (outputForegroundPixels < 4) throw new Error('Prepared visual-hull silhouette is too small.');
  const rows = Array.from({ length: height }, (_, y) => Array.from(
    output.subarray(y * width, (y + 1) * width),
    (value) => value ? '1' : '0',
  ).join(''));
  return {
    rows,
    width,
    height,
    sourceBounds,
    sourceForegroundPixels,
    filledHolePixels: solid.filled,
    outputForegroundPixels,
    coverageThreshold,
  };
}
