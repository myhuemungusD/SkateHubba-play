import { vi, beforeEach } from "vitest";

import { _resetCreateGameRateLimit } from "../games";
import { _resetNotificationRateLimit } from "../notifications";

/* ── mock firebase/firestore ────────────────── */
// `vi.hoisted` runs before all imports — required so `vi.mock` below can
// reference the spies. We can't `export` hoisted bindings directly (vitest
// rewrites them and throws), so we hoist into a local then re-export through
// regular module bindings.
const hoisted = vi.hoisted(() => ({
  mockAddDoc: vi.fn(),
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockGetDocs: vi.fn(),
  mockRunTransaction: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockDoc: vi.fn((...args: unknown[]) => {
    const path = args.slice(1).join("/");
    return { __path: path, id: String(path).split("/").pop() || "auto-id" };
  }),
  mockCollection: vi.fn((...args: unknown[]) => args[1]),
  mockQuery: vi.fn((...args: unknown[]) => args),
  mockWhere: vi.fn((...args: unknown[]) => args),
  mockLimit: vi.fn((...args: unknown[]) => args),
  mockOrderBy: vi.fn((...args: unknown[]) => args),
  mockTxGet: vi.fn(),
  mockTxUpdate: vi.fn(),
  mockBatchSet: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
  mockWriteBatch: vi.fn(),
}));

const {
  mockAddDoc,
  mockSetDoc,
  mockGetDocs,
  mockRunTransaction,
  mockOnSnapshot,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockLimit,
  mockOrderBy,
  mockTxGet,
  mockTxUpdate,
  mockBatchSet,
  mockBatchCommit,
  mockWriteBatch,
} = hoisted;

export {
  mockAddDoc,
  mockSetDoc,
  mockGetDocs,
  mockRunTransaction,
  mockOnSnapshot,
  mockDoc,
  mockCollection,
  mockQuery,
  mockWhere,
  mockLimit,
  mockOrderBy,
  mockTxGet,
  mockTxUpdate,
  mockBatchSet,
  mockBatchCommit,
  mockWriteBatch,
};

vi.mock("firebase/firestore", () => ({
  // Reference the hoisted bag directly — destructured bindings are still in
  // their temporal dead zone when this factory's `vi.mock` call evaluates.
  collection: hoisted.mockCollection,
  doc: hoisted.mockDoc,
  addDoc: hoisted.mockAddDoc,
  setDoc: hoisted.mockSetDoc,
  getDocs: hoisted.mockGetDocs,
  runTransaction: hoisted.mockRunTransaction,
  query: hoisted.mockQuery,
  where: hoisted.mockWhere,
  limit: hoisted.mockLimit,
  orderBy: hoisted.mockOrderBy,
  onSnapshot: hoisted.mockOnSnapshot,
  writeBatch: hoisted.mockWriteBatch,
  serverTimestamp: () => "SERVER_TS",
  arrayUnion: (...elements: unknown[]) => ({ _arrayUnion: elements }),
  Timestamp: {
    fromMillis: (ms: number) => ({ _ms: ms, toMillis: () => ms }),
  },
}));

vi.mock("../../firebase");

// Holds the most recent in-tx notification writes (from writeNotificationInTx)
// so tests can assert on them. Reset each test in beforeEach.
export const mockTxSetCalls: Array<{ ref: unknown; data: Record<string, unknown> }> = [];

/**
 * Wires the shared `beforeEach` setup used by every split games.* test file.
 * Each split file calls this once so the mock state stays consistent — keep
 * the body identical to the original monolith to preserve behavior.
 */
export function installGamesTestBeforeEach(): void {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetCreateGameRateLimit();
    // Notification rate-limit state is module-scoped — if we don't clear it
    // between tests, the second createGame in a file hits the 5s cooldown and
    // silently skips the notification write, making rate-limit assertions flaky.
    _resetNotificationRateLimit();
    mockSetDoc.mockResolvedValue(undefined);
    mockBatchCommit.mockResolvedValue(undefined);
    // writeBatch() returns a fresh batch object on each call. The factory wires
    // .set / .commit through the same hoisted spies so tests can introspect them.
    mockWriteBatch.mockImplementation(() => ({
      set: mockBatchSet,
      commit: mockBatchCommit,
    }));
    mockTxSetCalls.length = 0;
    // Default: runTransaction calls the callback with a mock tx object. The
    // `set` spy captures in-tx writes (notifications + any other tx.set calls)
    // so tests can assert the game update and its sibling notification landed
    // atomically inside the same transaction.
    mockRunTransaction.mockImplementation(async (_db: unknown, cb: (tx: unknown) => unknown) => {
      const tx = {
        get: mockTxGet,
        update: mockTxUpdate,
        set: vi.fn((ref: unknown, data: Record<string, unknown>) => {
          mockTxSetCalls.push({ ref, data });
        }),
      };
      return cb(tx);
    });
  });
}

/* ── Helpers ────────────────────────────────── */

export function makeGameSnap(data: Record<string, unknown>, id = "g1") {
  return {
    exists: () => true,
    id,
    data: () => data,
  };
}

export function makeNotFoundSnap() {
  return { exists: () => false };
}

export const baseGame = {
  player1Uid: "p1",
  player2Uid: "p2",
  player1Username: "alice",
  player2Username: "bob",
  p1Letters: 0,
  p2Letters: 0,
  status: "active",
  currentTurn: "p1",
  phase: "setting",
  currentSetter: "p1",
  currentTrickName: null,
  currentTrickVideoUrl: null,
  matchVideoUrl: null,
  turnNumber: 1,
  winner: null,
};
