export class SerializedTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private readonly pending = new Map<string, Promise<unknown>>();

  constructor(private readonly maximumPending = 4) {
    if (!Number.isInteger(maximumPending) || maximumPending < 1 || maximumPending > 32) {
      throw new Error('Serialized task queue capacity must be an integer from 1 to 32.');
    }
  }

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (!/^[a-zA-Z0-9:_-]{1,160}$/.test(key)) throw new Error('Serialized task key is invalid.');
    const duplicate = this.pending.get(key);
    if (duplicate) return duplicate as Promise<T>;
    if (this.pending.size >= this.maximumPending) throw new Error('Local validation queue is full.');

    const work = this.tail.catch(() => undefined).then(task);
    this.pending.set(key, work);
    this.tail = work.then(() => undefined, () => undefined);
    void work.finally(() => {
      if (this.pending.get(key) === work) this.pending.delete(key);
    }).catch(() => undefined);
    return work;
  }

  get pendingCount(): number {
    return this.pending.size;
  }
}
