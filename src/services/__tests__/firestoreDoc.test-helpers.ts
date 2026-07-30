/**
 * Shared `firebase/firestore` mock harness for document-oriented service
 * tests (feed queries, transactional counter writes, cascade deletes).
 *
 * Follows the same arrangement as `games.test-helpers.ts`: `vi.hoisted` runs
 * before all imports so the `vi.mock` factory below can reference the spies,
 * and the hoisted bindings are re-exported through regular module bindings
 * (vitest rewrites hoisted exports and throws if you export them directly).
 *
 * Importing this module installs the mock — there is no opt-in call.
 *
 * `clips.test.ts` still carries its own copy of this preamble. Migrating it
 * is a mechanical follow-up, deliberately not bundled into the change that
 * introduced this file: that suite is load-bearing for the clips feed and
 * churning its harness alongside a feature change would put 77 passing tests
 * at risk for no functional gain.
 */
import { vi } from "vitest";

const hoisted = vi.hoisted(() => {
  /** Minimal Timestamp stand-in — services call `toMillis()` and, on the
   * write path, the `Timestamp.fromMillis(ms)` static (e.g. raiseDispute's
   * reviewDeadline). */
  class FakeTimestamp {
    constructor(public _ms: number) {}
    toMillis() {
      return this._ms;
    }
    static fromMillis(ms: number): FakeTimestamp {
      return new FakeTimestamp(ms);
    }
  }
  return {
    mockCollection: vi.fn((_db: unknown, name: string) => ({ __collection: name })),
    // `__path` is what the transaction router keys on to decide which stub
    // snapshot a given `tx.get(ref)` should resolve to.
    mockDoc: vi.fn((_db: unknown, collectionName: string, id: string) => ({
      __path: `${collectionName}/${id}`,
      id,
    })),
    mockQuery: vi.fn((...args: unknown[]) => ({ __query: args })),
    mockWhere: vi.fn((field: unknown, op: unknown, value: unknown) => ({ __where: { field, op, value } })),
    mockOrderBy: vi.fn((field: unknown, dir: unknown) => ({ __orderBy: { field, dir } })),
    mockLimit: vi.fn((n: number) => ({ __limit: n })),
    mockDocumentId: vi.fn(() => ({ __documentId: true })),
    mockGetDocs: vi.fn(),
    mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
    mockServerTimestamp: vi.fn(() => "SERVER_TS"),
    mockRunTransaction: vi.fn(),
    FakeTimestamp,
  };
});

export const {
  mockCollection,
  mockDoc,
  mockQuery,
  mockWhere,
  mockOrderBy,
  mockLimit,
  mockDocumentId,
  mockGetDocs,
  mockDeleteDoc,
  mockServerTimestamp,
  mockRunTransaction,
  FakeTimestamp,
} = hoisted;

vi.mock("firebase/firestore", () => ({
  collection: hoisted.mockCollection,
  doc: hoisted.mockDoc,
  query: hoisted.mockQuery,
  where: hoisted.mockWhere,
  orderBy: hoisted.mockOrderBy,
  limit: hoisted.mockLimit,
  documentId: hoisted.mockDocumentId,
  getDocs: hoisted.mockGetDocs,
  deleteDoc: hoisted.mockDeleteDoc,
  serverTimestamp: hoisted.mockServerTimestamp,
  runTransaction: hoisted.mockRunTransaction,
  Timestamp: hoisted.FakeTimestamp,
}));

vi.mock("../../firebase");

/** The Transaction stub a service body actually received. */
export type ObservedTx = {
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
};

/**
 * Wire `mockRunTransaction` for a single call, routing `tx.get` by the ref's
 * `__path` prefix (produced by `mockDoc` above) to a per-collection stub
 * snapshot. Returns an accessor for the Transaction the service body saw, so
 * a test can assert on the writes it staged.
 *
 * Throws on an unrouted path rather than returning an empty snapshot — a
 * service reading a ref the test didn't anticipate is a bug worth surfacing,
 * not a silent `exists: false`.
 */
export function captureTxOnce(reads: Record<string, { exists: boolean; data?: Record<string, unknown> }>): {
  observed: () => ObservedTx;
} {
  let captured: ObservedTx | undefined;
  hoisted.mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
    const tx: ObservedTx = {
      get: vi.fn().mockImplementation(async (ref: { __path?: string }) => {
        const path = ref.__path ?? "";
        const collectionName = path.slice(0, path.indexOf("/"));
        const hit = reads[collectionName];
        if (!hit) throw new Error(`Unexpected ref path in tx.get: ${path}`);
        return { exists: () => hit.exists, data: () => hit.data };
      }),
      set: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
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
