import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { afterEach, describe, expect, it } from 'vitest';
import { compareReferenceFrames } from '../src/engine/reference-comparison';
import { lockedCanvasFrame, normalizedFrame } from '../scripts/lib/visual-capture-frames';

const temporaryDirectories: string[] = [];

async function rectangleCapture(directory: string, name: string, x: number): Promise<string> {
  const canvas = createCanvas(128, 128);
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, 128, 128);
  context.fillStyle = '#486fa8';
  context.fillRect(x, 34, 36, 60);
  const path = join(directory, name);
  await writeFile(path, canvas.toBuffer('image/png'));
  return path;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('locked visual capture coordinates', () => {
  it('keeps same-camera translation errors that independent foreground fitting hides', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'morphloom-locked-canvas-'));
    temporaryDirectories.push(directory);
    const referencePath = await rectangleCapture(directory, 'reference.png', 12);
    const shiftedPath = await rectangleCapture(directory, 'shifted.png', 76);

    const fittedReference = await normalizedFrame(referencePath);
    const fittedShifted = await normalizedFrame(shiftedPath, fittedReference.aspect);
    expect(compareReferenceFrames(fittedReference.frame, fittedShifted.frame).silhouetteIoU).toBe(1);

    const lockedReference = await lockedCanvasFrame(referencePath);
    const lockedShifted = await lockedCanvasFrame(shiftedPath);
    const locked = compareReferenceFrames(lockedReference.frame, lockedShifted.frame);
    expect(locked.silhouetteIoU).toBe(0);
    expect(locked.interiorSimilarity).toBe(0);
  });
});
