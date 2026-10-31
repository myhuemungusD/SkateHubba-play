/**
 * A promise the test settles by hand, for driving fetch/write races in the
 * feed controllers (resolve after unmount, overlap two calls, and so on).
 */
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
