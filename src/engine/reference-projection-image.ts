export interface OpaqueProjectionImage {
  rgba: Uint8ClampedArray;
  filledPixels: number;
  sourcePixels: number;
}

const MAX_PROJECTION_PIXELS = 16_777_216;

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
