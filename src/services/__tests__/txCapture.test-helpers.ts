/**
 * One-shot `runTransaction` capture, shared by the clip write-path suites.
 *
 * Every transactional service test wants the same three things: stub the
 * reads, run the service body once, then assert on the writes it staged.
 * Each suite used to carry its own copy of that closure; this is the single
 * implementation they now share.
 *
 * The transaction mock is passed in rather than imported because the suites
 * install their own `firebase/firestore` doubles (they need different slices
 * of the SDK), so there is no one mock function to reach for.
 */
import { vi } from "vitest";

/** The Transaction stub a service body actually received. */
export interface CapturedTx {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  /** Write ops in the order the service staged them ("set" | "update" | "delete"). */
  order: string[];
}

/** Snapshot stand-in: what a stubbed `tx.get(ref)` resolves to. */
export interface StubSnap {
  exists: () => boolean;
  data: () => unknown;
}

/** Minimal shape of a mocked `runTransaction`. */
type TxMock = { mockImplementationOnce: (fn: (db: unknown, cb: (tx: unknown) => Promise<void>) => unknown) => unknown };

/**
 * Wire ONE transaction whose `tx.get(ref)` is answered by `route`, and
 * return an accessor for the Transaction the service body saw.
 *
 * `route` receives the ref's `__path` (as produced by the suites' `doc`
 * doubles) and returns the snapshot to resolve. Throwing from `route` is the
 * right response to an unexpected read: a service touching a ref the test
 * didn't anticipate is a bug worth surfacing, not a silent `exists: false`.
 */
export function captureTx(runTransaction: TxMock, route: (path: string) => StubSnap): { observed: () => CapturedTx } {
  let captured: CapturedTx | undefined;
  runTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
    const order: string[] = [];
    const tx: CapturedTx = {
      get: vi.fn().mockImplementation(async (ref: { __path?: string }) => route(ref.__path ?? "")),
      set: vi.fn(() => order.push("set")),
      update: vi.fn(() => order.push("update")),
      delete: vi.fn(() => order.push("delete")),
      order,
    };
    captured = tx;
    await cb(tx);
  });
  return {
    observed: () => {
      if (!captured) throw new Error("transaction was never invoked");
      return captured;
    },
  };
}

/** Snapshot for a document that exists, carrying `body`. */
export function present(body: unknown): StubSnap {
  return { exists: () => true, data: () => body };
}

/** Snapshot for a document that does not exist. */
export function absent(): StubSnap {
  return { exists: () => false, data: () => undefined };
}
