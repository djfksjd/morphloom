/** Bounded ownership of an async result. Cancellation does not abort underlying I/O. */
export function createLatestIntentGate() {
  let current: symbol | undefined;
  return {
    begin(): symbol { current = Symbol('latest-intent'); return current; },
    cancel(): void { current = undefined; },
    isCurrent(token: symbol): boolean { return current !== undefined && current === token; },
  };
}
