import { createHash } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';

export type HoldoutCandidate = {
  sourceItemId: string;
  spinId: string;
};

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function isPathInside(parentPath: string, candidatePath: string): boolean {
  const child = relative(parentPath, candidatePath);
  return child.length > 0 && !child.startsWith('..') && !isAbsolute(child);
}

export function chooseSeededHoldout<T extends HoldoutCandidate>(
  candidates: readonly T[],
  seedCommit: string,
): T {
  if (candidates.length === 0) throw new Error('No eligible unseen holdout candidate was found.');
  return [...candidates].sort((left, right) => (
    sha256(`${seedCommit}:${left.sourceItemId}:${left.spinId}`)
      .localeCompare(sha256(`${seedCommit}:${right.sourceItemId}:${right.spinId}`))
    || left.sourceItemId.localeCompare(right.sourceItemId)
    || left.spinId.localeCompare(right.spinId)
  ))[0]!;
}

export function safeAboSpinUrl(baseUrl: string, indexedPath: string): string {
  if (!/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+\.jpg$/.test(indexedPath)) {
    throw new Error('ABO spin path did not match the trusted dataset path format.');
  }
  const base = new URL(baseUrl);
  const resolved = new URL(indexedPath, base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    throw new Error('ABO spin path escaped the trusted dataset origin or directory.');
  }
  return resolved.href;
}

export async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (!body || !Number.isSafeInteger(maximumBytes) || maximumBytes < 1) {
    throw new Error('Response body or byte limit is invalid.');
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel('Holdout input exceeded the byte limit.');
        throw new Error('Holdout input exceeded the byte limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
