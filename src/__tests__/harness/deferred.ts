/**
 * Manually-resolvable promise for deterministic interleaving in tests.
 *
 * Hand the `promise` to a mocked service call, drive the UI, then resolve or
 * reject at the exact point the assertion needs — the only reliable way to
 * observe optimistic state before a write settles.
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
