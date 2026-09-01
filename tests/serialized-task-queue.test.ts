import { describe, expect, it } from 'vitest';
import { SerializedTaskQueue } from '../src/engine/serialized-task-queue';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
};

describe('serialized local task queue', () => {
  it('deduplicates identical work and never overlaps different heavy tasks', async () => {
    const queue = new SerializedTaskQueue();
    const firstGate = deferred<string>();
    const order: string[] = [];
    const first = queue.run('same-key', async () => {
      order.push('first:start');
      const value = await firstGate.promise;
      order.push('first:end');
      return value;
    });
    const duplicate = queue.run('same-key', async () => 'must-not-run');
    const second = queue.run('next-key', async () => {
      order.push('second:start');
      return 'second';
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(duplicate).toBe(first);
    expect(order).toEqual(['first:start']);
    expect(queue.pendingCount).toBe(2);
    firstGate.resolve('first');
    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['first:start', 'first:end', 'second:start']);
    expect(queue.pendingCount).toBe(0);
  });

  it('continues after a failed task and enforces its bounded capacity', async () => {
    const queue = new SerializedTaskQueue(2);
    const gate = deferred<void>();
    const first = queue.run('first', () => gate.promise);
    const second = queue.run('second', async () => 'recovered');
    expect(() => queue.run('third', async () => 'overflow')).toThrow(/queue is full/);
    gate.reject(new Error('expected failure'));
    await expect(first).rejects.toThrow('expected failure');
    await expect(second).resolves.toBe('recovered');
    expect(queue.pendingCount).toBe(0);
  });

  it('rejects malformed or unbounded task identities', () => {
    const queue = new SerializedTaskQueue();
    expect(() => queue.run('', async () => undefined)).toThrow(/key is invalid/);
    expect(() => queue.run('x'.repeat(161), async () => undefined)).toThrow(/key is invalid/);
    expect(() => new SerializedTaskQueue(0)).toThrow(/capacity/);
  });
});
