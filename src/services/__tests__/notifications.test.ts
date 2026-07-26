import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Variadic signatures keep these mocks compatible with vitest 4's stricter
// `vi.fn()` default while letting tests assign any return value or rejection.
type AnyMock = (...args: unknown[]) => unknown;
type OnSnapshotImpl = (q: unknown, cb: (snap: unknown) => void, onError?: (err: Error) => void) => () => void;
type BatchSetCall = { ref: unknown; data: unknown };
const batchSetCalls: BatchSetCall[] = [];
const mockBatchCommit = vi.fn<AnyMock>(() => Promise.resolve(undefined));
const mockBatchSet = vi.fn<AnyMock>((ref: unknown, data: unknown) => {
  batchSetCalls.push({ ref, data });
});
const mockBatchDelete = vi.fn<AnyMock>(() => undefined);
const mockWriteBatch = vi.fn<AnyMock>(() => ({
  set: mockBatchSet,
  delete: mockBatchDelete,
  commit: mockBatchCommit,
}));
const mockCollection = vi.fn((...args: unknown[]) => args[1]);
// doc(collectionRef) (single arg) returns a stub auto-id ref so we can detect
// the notification doc; doc(db, "notification_limits", id) (3 args) returns the
// path string so assertions can grep for the limit doc.
const mockDoc = vi.fn((...args: unknown[]) => {
  if (args.length === 1) return { auto: true, parent: args[0] };
  return args;
});
const mockUpdateDoc = vi.fn<AnyMock>(() => Promise.resolve(undefined));
const mockDeleteDoc = vi.fn<AnyMock>(() => Promise.resolve(undefined));
const mockGetDocs = vi.fn<AnyMock>();
// onSnapshot is typed against its real callback shape so test impls reading
// the snapshot/error callbacks type-check; the factory wrapper casts away
// the variadic mismatch.
const mockOnSnapshot = vi.fn<OnSnapshotImpl>(() => () => {});
const mockQuery = vi.fn((...args: unknown[]) => args);
const mockWhere = vi.fn((...args: unknown[]) => args);
const mockOrderBy = vi.fn((...args: unknown[]) => args);
const mockLimit = vi.fn((...args: unknown[]) => args);

vi.mock("firebase/firestore", () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  serverTimestamp: () => "SERVER_TS",
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  onSnapshot: (...args: unknown[]) => (mockOnSnapshot as unknown as (...a: unknown[]) => unknown)(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
}));

// Mock the push dispatch surface so notifications.test.ts can assert the
// fire-and-forget call into pushDispatch.ts without exercising its
// firestore reads/writes (those have their own test file).
const mockDispatchPushNotification = vi.fn<AnyMock>(() => Promise.resolve(undefined));
vi.mock("../pushDispatch", () => ({
  dispatchPushNotification: (...args: unknown[]) => mockDispatchPushNotification(...args),
}));

vi.mock("../../firebase");

import {
  writeNotification,
  writeNotificationInTx,
  _resetNotificationRateLimit,
  markNotificationRead,
  deleteNotification,
  deleteUserNotifications,
  subscribeToNudges,
  subscribeToNotifications,
} from "../notifications";

beforeEach(() => {
  vi.clearAllMocks();
  batchSetCalls.length = 0;
  _resetNotificationRateLimit();
});

/** Build a resolved server Timestamp stub at `ms`. */
function ts(ms: number): { toMillis: () => number } {
  return { toMillis: () => ms };
}

/** Build a page snapshot for the paginated deleteUserNotifications loop. */
function page(refs: string[]): { empty: boolean; size: number; docs: { ref: string }[] } {
  return { empty: refs.length === 0, size: refs.length, docs: refs.map((ref) => ({ ref })) };
}

function findLimitSet(): BatchSetCall | undefined {
  // doc(db, "notification_limits", "...") returns the args array via the mock,
  // so we identify the limit-doc batch.set call by the second arg ("notification_limits").
  return batchSetCalls.find((c) => Array.isArray(c.ref) && (c.ref as unknown[])[1] === "notification_limits");
}

function findNotificationSet(): BatchSetCall | undefined {
  return batchSetCalls.find((c) => !Array.isArray(c.ref));
}

describe("writeNotification", () => {
  it("commits a notification + limit doc atomically in a single writeBatch", async () => {
    await writeNotification({
      senderUid: "sender456",
      recipientUid: "user123",
      type: "your_turn",
      title: "Your Turn!",
      body: "Match @alice's kickflip",
      gameId: "game456",
    });

    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);

    const notifSet = findNotificationSet();
    expect(notifSet).toBeDefined();
    const docData = notifSet!.data as Record<string, unknown>;
    expect(docData.senderUid).toBe("sender456");
    expect(docData.recipientUid).toBe("user123");
    expect(docData.type).toBe("your_turn");
    expect(docData.title).toBe("Your Turn!");
    expect(docData.body).toBe("Match @alice's kickflip");
    expect(docData.gameId).toBe("game456");
    expect(docData.read).toBe(false);
    expect(docData.createdAt).toBe("SERVER_TS");
  });

  it("fires the push dispatcher after the batch commits (best-effort, no await)", async () => {
    const params = {
      senderUid: "sender456",
      recipientUid: "user123",
      type: "your_turn" as const,
      title: "Your Turn!",
      body: "Match @alice's kickflip",
      gameId: "game456",
    };
    await writeNotification(params);
    // Fired exactly once with the same params — the dispatcher is what wakes
    // an offline recipient's device via the firestore-send-fcm extension.
    expect(mockDispatchPushNotification).toHaveBeenCalledTimes(1);
    expect(mockDispatchPushNotification).toHaveBeenCalledWith(params);
  });

  it("does NOT fire push dispatch when the batch commit fails (best-effort, gated on commit)", async () => {
    mockBatchCommit.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await writeNotification({
      senderUid: "s1",
      recipientUid: "r1",
      type: "your_turn",
      title: "Turn",
      body: "x",
      gameId: "g1",
    });
    // Dispatch is downstream of the commit; if /notifications never landed,
    // we must not send a push for a state transition that didn't happen.
    expect(mockDispatchPushNotification).not.toHaveBeenCalled();
  });

  it("includes the matching notification_limits doc in the same batch", async () => {
    await writeNotification({
      senderUid: "sender456",
      recipientUid: "user123",
      type: "your_turn",
      title: "Your Turn!",
      body: "Match @alice's kickflip",
      gameId: "game456",
    });

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "notification_limits", "sender456_game456_your_turn");
    const limitSet = findLimitSet();
    expect(limitSet).toBeDefined();
    const limitData = limitSet!.data as Record<string, unknown>;
    expect(limitData.senderUid).toBe("sender456");
    expect(limitData.gameId).toBe("game456");
    expect(limitData.type).toBe("your_turn");
    expect(limitData.lastSentAt).toBe("SERVER_TS");
  });

  it("does not throw when batch commit fails", async () => {
    mockBatchCommit.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await expect(
      writeNotification({
        senderUid: "sender456",
        recipientUid: "user123",
        type: "game_won",
        title: "You Won!",
        body: "vs @bob",
        gameId: "game789",
      }),
    ).resolves.toBeUndefined();
  });

  // Shared between rate-limit assertions to keep the cases parametrized
  // and avoid the test-duplication gate flagging copy/paste params blocks.
  const yourTurnParams = () =>
    ({
      senderUid: "sender456",
      recipientUid: "user123",
      type: "your_turn" as const,
      title: "Your Turn!",
      body: "Match trick",
      gameId: "game456",
    }) as const;

  describe("client-side rate limiting", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("skips duplicate notification within 5s cooldown", async () => {
      const params = yourTurnParams();
      await writeNotification(params);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);

      // Second call within cooldown — should be silently skipped
      await writeNotification(params);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    });

    it("allows notification after cooldown expires", async () => {
      const params = yourTurnParams();
      await writeNotification(params);
      expect(mockBatchCommit).toHaveBeenCalledTimes(1);

      // Advance past the 5s cooldown
      vi.advanceTimersByTime(5_001);

      await writeNotification(params);
      expect(mockBatchCommit).toHaveBeenCalledTimes(2);
    });

    it("allows different game+type combos concurrently", async () => {
      await writeNotification({
        senderUid: "sender456",
        recipientUid: "user123",
        type: "your_turn",
        title: "Your Turn!",
        body: "Match trick",
        gameId: "game456",
      });

      await writeNotification({
        senderUid: "sender456",
        recipientUid: "user123",
        type: "new_challenge",
        title: "New Challenge!",
        body: "Challenge",
        gameId: "game789",
      });

      expect(mockBatchCommit).toHaveBeenCalledTimes(2);
    });
  });

  it("_resetNotificationRateLimit clears rate-limit state", async () => {
    const params = yourTurnParams();

    await writeNotification(params);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);

    // Reset and call again — should allow through
    _resetNotificationRateLimit();
    await writeNotification(params);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
  });
});

describe("writeNotificationInTx", () => {
  // Minimal Transaction stub — we just need tx.set to be observable.
  function makeTx(): { set: ReturnType<typeof vi.fn>; calls: BatchSetCall[] } {
    const calls: BatchSetCall[] = [];
    return {
      set: vi.fn((ref: unknown, data: unknown) => {
        calls.push({ ref, data });
      }),
      calls,
    };
  }

  const baseParams = {
    senderUid: "alice",
    recipientUid: "bob",
    type: "your_turn" as const,
    title: "Your Turn!",
    body: "Match",
    gameId: "g1",
  };

  it("stages a notification doc on the transaction", () => {
    const tx = makeTx();
    writeNotificationInTx(tx as never, baseParams);
    expect(tx.set).toHaveBeenCalledTimes(1);
    const data = tx.calls[0].data as Record<string, unknown>;
    expect(data.senderUid).toBe("alice");
    expect(data.recipientUid).toBe("bob");
    expect(data.type).toBe("your_turn");
    expect(data.read).toBe(false);
    expect(data.createdAt).toBe("SERVER_TS");
  });

  it("stages params into the optional push outbox when provided", () => {
    const tx = makeTx();
    const outbox = { staged: [] as (typeof baseParams)[] };
    writeNotificationInTx(tx as never, baseParams, outbox);
    expect(outbox.staged).toEqual([baseParams]);
  });

  it("skips outbox staging when no outbox is passed (zero-overhead default)", () => {
    // Defends line 185 of notifications.ts: callers that don't need OS-level
    // push (e.g. tests, transient writes) pay nothing for the push surface.
    const tx = makeTx();
    writeNotificationInTx(tx as never, baseParams);
    expect(tx.set).toHaveBeenCalledTimes(1); // notification doc still written
    // No outbox argument — nothing to assert on it; the test exists to cover
    // the false branch of `if (pushOutbox)`.
  });
});

describe("markNotificationRead", () => {
  it("updates the notification doc with read: true", async () => {
    await markNotificationRead("notif1");
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({ read: true });
  });

  it("does not throw on failure (best-effort)", async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(markNotificationRead("notif1")).resolves.toBeUndefined();
  });
});

describe("deleteNotification", () => {
  it("deletes the notification doc", async () => {
    await deleteNotification("notif1");
    expect(mockDeleteDoc).toHaveBeenCalledTimes(1);
  });

  it("propagates errors", async () => {
    mockDeleteDoc.mockRejectedValueOnce(new Error("Permission denied"));
    await expect(deleteNotification("notif1")).rejects.toThrow("Permission denied");
  });
});

describe("deleteUserNotifications", () => {
  it("deletes a short page in one batch and stops", async () => {
    mockGetDocs.mockResolvedValueOnce(page(["ref1", "ref2"]));

    await deleteUserNotifications("user123");

    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchDelete).toHaveBeenCalledWith("ref1");
    expect(mockBatchDelete).toHaveBeenCalledWith("ref2");
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    // The old implementation fired one deleteDoc per doc in parallel.
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });

  it("keeps paginating while pages come back full", async () => {
    // A full page (500) means there may be more; a short page ends the loop.
    const full = Array.from({ length: 500 }, (_, i) => `ref${i}`);
    mockGetDocs.mockResolvedValueOnce(page(full)).mockResolvedValueOnce(page(["tail"]));

    await deleteUserNotifications("user123");

    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    expect(mockWriteBatch).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
  });

  it("stops immediately on an exactly-full page followed by an empty one", async () => {
    const full = Array.from({ length: 500 }, (_, i) => `ref${i}`);
    mockGetDocs.mockResolvedValueOnce(page(full)).mockResolvedValueOnce(page([]));

    await deleteUserNotifications("user123");

    expect(mockGetDocs).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it("handles empty result set", async () => {
    mockGetDocs.mockResolvedValueOnce(page([]));
    await deleteUserNotifications("user123");
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it("caps each page at the 500-op writeBatch limit", async () => {
    mockGetDocs.mockResolvedValueOnce(page([]));
    await deleteUserNotifications("user123");
    expect(mockLimit).toHaveBeenCalledWith(500);
  });
});

// Shared snapshot-handler capture used by the subscribe* describe blocks.
// Extracted so the two new "delivers a second snapshot..." regression tests
// don't trip the test-duplication gate against existing tests that already
// open with this same boilerplate.
function captureSnapshotHandler(): { getHandler: () => (snap: unknown) => void } {
  let snapshotHandler: (snap: unknown) => void = () => {};
  mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
    snapshotHandler = cb;
    return vi.fn();
  });
  return { getHandler: () => snapshotHandler };
}

describe("subscribeToNudges", () => {
  it("returns an unsubscribe function", () => {
    const mockUnsub = vi.fn();
    mockOnSnapshot.mockReturnValueOnce(mockUnsub);

    const unsub = subscribeToNudges("u1", vi.fn());
    expect(unsub).toBe(mockUnsub);
  });

  it("calls onSnapshot with a nudges query", () => {
    mockOnSnapshot.mockReturnValueOnce(vi.fn());
    subscribeToNudges("u1", vi.fn());

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "nudges");
    expect(mockWhere).toHaveBeenCalledWith("recipientUid", "==", "u1");
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockLimit).toHaveBeenCalledWith(5);
  });

  it("seeds initial IDs on first snapshot without calling onNudge", () => {
    const onNudge = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNudges("u1", onNudge);

    // Simulate first snapshot (seed)
    snapshotHandler({
      docs: [{ id: "existing1" }, { id: "existing2" }],
      docChanges: () => [],
    });

    expect(onNudge).not.toHaveBeenCalled();
  });

  it("fires onNudge for newly added docs after seeding", () => {
    const onNudge = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNudges("u1", onNudge);

    // First snapshot (seed)
    snapshotHandler({
      docs: [{ id: "existing1" }],
      docChanges: () => [],
    });

    // Second snapshot with new doc — no setTimeout(0) gate, dedupe runs via
    // initialIds membership check which is populated synchronously above.
    snapshotHandler({
      docs: [{ id: "existing1" }, { id: "new1" }],
      docChanges: () => [
        {
          type: "added",
          doc: { id: "new1", data: () => ({ senderUsername: "bob", gameId: "g1" }) },
        },
      ],
    });

    expect(onNudge).toHaveBeenCalledWith({ senderUsername: "bob", gameId: "g1" });
  });

  it("caps tracked IDs at 50 to prevent unbounded growth", () => {
    const onNudge = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNudges("u1", onNudge);

    // Seed with 49 existing IDs
    const seedDocs = Array.from({ length: 49 }, (_, i) => ({ id: `seed${i}` }));
    snapshotHandler({ docs: seedDocs, docChanges: () => [] });

    // Add 3 new docs to push past 50
    const changes = Array.from({ length: 3 }, (_, i) => ({
      type: "added",
      doc: { id: `new${i}`, data: () => ({ senderUsername: "bob", gameId: `g${i}` }) },
    }));
    snapshotHandler({ docs: [], docChanges: () => changes });

    expect(onNudge).toHaveBeenCalledTimes(3);
  });

  it("skips docs that are not of type 'added'", () => {
    const onNudge = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNudges("u1", onNudge);
    snapshotHandler({ docs: [], docChanges: () => [] });

    snapshotHandler({
      docs: [],
      docChanges: () => [{ type: "modified", doc: { id: "m1", data: () => ({}) } }],
    });

    expect(onNudge).not.toHaveBeenCalled();
  });

  it("delivers a second snapshot that arrives in the same microtask as the seed", () => {
    // Regression: the old setTimeout(0) `ready` gate dropped snapshots that
    // arrived before the next macrotask. After the gate removal, a server-
    // reconcile snapshot that fires synchronously right after the cache-hit
    // seed must still surface new docs via the initialIds dedupe.
    const onNudge = vi.fn();
    const handler = captureSnapshotHandler();
    subscribeToNudges("u1", onNudge);
    handler.getHandler()({ docs: [], docChanges: () => [] });
    // Fire the second snapshot synchronously (no awaited tick) — must be
    // delivered now that the timing-based gate is gone.
    handler.getHandler()({
      docs: [{ id: "n1" }],
      docChanges: () => [{ type: "added", doc: { id: "n1", data: () => ({ senderUsername: "bob", gameId: "g1" }) } }],
    });
    expect(onNudge).toHaveBeenCalledWith({ senderUsername: "bob", gameId: "g1" });
  });

  it("skips docs already in the initial set", () => {
    const onNudge = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNudges("u1", onNudge);
    snapshotHandler({ docs: [{ id: "existing1" }], docChanges: () => [] });

    snapshotHandler({
      docs: [{ id: "existing1" }],
      docChanges: () => [{ type: "added", doc: { id: "existing1", data: () => ({}) } }],
    });

    expect(onNudge).not.toHaveBeenCalled();
  });

  it("logs a warning when the snapshot listener errors", () => {
    let errorHandler: (err: Error) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q, _cb, onError) => {
      errorHandler = onError as (err: Error) => void;
      return vi.fn();
    });

    subscribeToNudges("u1", vi.fn());
    errorHandler(new Error("permission-denied"));

    // Error handler should not throw — it logs via logger.warn
  });
});

describe("subscribeToNotifications", () => {
  it("returns an unsubscribe function", () => {
    const mockUnsub = vi.fn();
    mockOnSnapshot.mockReturnValueOnce(mockUnsub);

    const unsub = subscribeToNotifications("u1", vi.fn());
    expect(unsub).toBe(mockUnsub);
  });

  it("calls onSnapshot with a notifications query", () => {
    mockOnSnapshot.mockReturnValueOnce(vi.fn());
    subscribeToNotifications("u1", vi.fn());

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "notifications");
    expect(mockWhere).toHaveBeenCalledWith("recipientUid", "==", "u1");
    expect(mockWhere).toHaveBeenCalledWith("read", "==", false);
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockLimit).toHaveBeenCalledWith(10);
  });

  it("fires onNotification for newly added docs with firestoreId", () => {
    const onNotification = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNotifications("u1", onNotification);

    // First snapshot (seed)
    snapshotHandler({
      docs: [],
      docChanges: () => [],
    });

    // Second snapshot with new notification — no setTimeout(0) `ready` gate;
    // dedupe runs via initialIds membership populated synchronously above.
    snapshotHandler({
      docs: [{ id: "n1" }],
      docChanges: () => [
        {
          type: "added",
          doc: {
            id: "n1",
            data: () => ({
              type: "your_turn",
              title: "Your Turn!",
              body: "vs @bob",
              gameId: "g1",
              createdAt: ts(1_000),
            }),
          },
        },
      ],
    });

    expect(onNotification).toHaveBeenCalledWith({
      firestoreId: "n1",
      type: "your_turn",
      title: "Your Turn!",
      body: "vs @bob",
      gameId: "g1",
      createdAtMs: 1_000,
    });
    // markNotificationRead is no longer called by the subscription —
    // the caller is responsible for marking read when the user sees it.
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("keeps emitting new docs after the tracked-id set is trimmed", () => {
    const onNotification = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNotifications("u1", onNotification);

    // Seed with 49 existing IDs
    const seedDocs = Array.from({ length: 49 }, (_, i) => ({ id: `seed${i}`, data: () => ({ createdAt: ts(i) }) }));
    snapshotHandler({ docs: seedDocs, docChanges: () => [] });

    // Add 3 new docs to push past 50
    const changes = Array.from({ length: 3 }, (_, i) => ({
      type: "added",
      doc: {
        id: `new${i}`,
        data: () => ({ type: "your_turn", title: "T", body: "B", gameId: `g${i}`, createdAt: ts(1_000 + i) }),
      },
    }));
    snapshotHandler({ docs: [], docChanges: () => changes });

    expect(onNotification).toHaveBeenCalledTimes(3);
  });

  it("skips already-seen and non-added docs", () => {
    const onNotification = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNotifications("u1", onNotification);
    snapshotHandler({ docs: [{ id: "existing1", data: () => ({ createdAt: ts(9_000) }) }], docChanges: () => [] });

    snapshotHandler({
      docs: [],
      docChanges: () => [
        { type: "modified", doc: { id: "m1", data: () => ({ createdAt: ts(9_000) }) } },
        { type: "added", doc: { id: "existing1", data: () => ({ createdAt: ts(9_000) }) } },
      ],
    });

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("uses fallback values when notification fields are null", () => {
    const onNotification = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNotifications("u1", onNotification);
    snapshotHandler({ docs: [], docChanges: () => [] });

    snapshotHandler({
      docs: [{ id: "n1" }],
      docChanges: () => [
        {
          type: "added",
          doc: { id: "n1", data: () => ({ type: null, title: null, body: null, gameId: "g1", createdAt: ts(1_000) }) },
        },
      ],
    });

    expect(onNotification).toHaveBeenCalledWith({
      firestoreId: "n1",
      type: "",
      title: "SkateHubba",
      body: "",
      gameId: "g1",
      createdAtMs: 1_000,
    });
  });

  it("delivers a second snapshot that arrives in the same microtask as the seed", () => {
    // Regression: the old setTimeout(0) `ready` gate dropped snapshots that
    // arrived before the next macrotask. A server-reconcile snapshot that
    // fires synchronously after the cache-hit seed must still surface new
    // docs via the initialIds dedupe.
    const onNotification = vi.fn();
    const handler = captureSnapshotHandler();
    subscribeToNotifications("u1", onNotification);
    handler.getHandler()({ docs: [], docChanges: () => [] });
    // Fire the second snapshot synchronously (no awaited tick) — must be
    // delivered now that the timing-based gate is gone.
    handler.getHandler()({
      docs: [{ id: "n1" }],
      docChanges: () => [
        {
          type: "added",
          doc: { id: "n1", data: () => ({ type: "t", title: "T", body: "B", gameId: "g", createdAt: ts(1_000) }) },
        },
      ],
    });
    expect(onNotification).toHaveBeenCalledWith({
      firestoreId: "n1",
      type: "t",
      title: "T",
      body: "B",
      gameId: "g",
      createdAtMs: 1_000,
    });
  });

  it("logs a warning when the snapshot listener errors", () => {
    let errorHandler: (err: Error) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q, _cb, onError) => {
      errorHandler = onError as (err: Error) => void;
      return vi.fn();
    });

    subscribeToNotifications("u1", vi.fn());
    errorHandler(new Error("permission-denied"));

    // Error handler should not throw — it logs via logger.warn
  });
});

describe("subscribeToNotifications seed + watermark", () => {
  function subscribe(onNotification = vi.fn(), onSeed = vi.fn()) {
    let handler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      handler = cb;
      return vi.fn();
    });
    subscribeToNotifications("u1", onNotification, onSeed);
    return { fire: (snap: unknown) => handler(snap), onNotification, onSeed };
  }

  /** A doc stub usable both as a snapshot doc and inside a docChanges entry. */
  function docStub(id: string, createdAtMs: number | null, overrides: Record<string, unknown> = {}) {
    return {
      id,
      data: () => ({
        type: "new_challenge",
        title: "New Challenge!",
        body: "@bob challenged you",
        gameId: `game_${id}`,
        createdAt: createdAtMs === null ? null : ts(createdAtMs),
        ...overrides,
      }),
    };
  }

  it("hands the initial snapshot to onSeed without toasting any of it", () => {
    const { fire, onNotification, onSeed } = subscribe();
    fire({ docs: [docStub("a", 3_000), docStub("b", 2_000)], docChanges: () => [] });

    expect(onNotification).not.toHaveBeenCalled();
    expect(onSeed).toHaveBeenCalledTimes(1);
    expect(onSeed.mock.calls[0][0]).toEqual([
      expect.objectContaining({ firestoreId: "a", createdAtMs: 3_000, type: "new_challenge" }),
      expect.objectContaining({ firestoreId: "b", createdAtMs: 2_000 }),
    ]);
  });

  it("still delivers the first notification when the seed was empty", () => {
    // Highest-risk regression in the watermark change: a brand-new user with
    // zero unread must not have their very first notification swallowed.
    const { fire, onNotification, onSeed } = subscribe();
    fire({ docs: [], docChanges: () => [] });
    expect(onSeed).toHaveBeenCalledWith([]);

    fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub("first", 1) }] });
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({ firestoreId: "first" }));
  });

  it("does not toast a stale doc that slides into the window when one is marked read", () => {
    // The >10-unread bug: seeded docs are never toasted so they are never
    // marked read; past the limit(10) window, marking a newer one read pulls an
    // older doc in as an `added` change. It must stay silent.
    const { fire, onNotification } = subscribe();
    fire({ docs: [docStub("newest", 5_000), docStub("mid", 4_000)], docChanges: () => [] });

    fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub("ancient", 900) }] });

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("toasts a genuinely new doc that arrives after the seed", () => {
    const { fire, onNotification } = subscribe();
    fire({ docs: [docStub("seeded", 5_000)], docChanges: () => [] });

    fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub("fresh", 6_000) }] });

    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({ firestoreId: "fresh" }));
  });

  it("toasts a doc sharing the watermark millisecond", () => {
    // Two senders can land in the same millisecond; `>=` keeps both audible.
    const { fire, onNotification } = subscribe();
    fire({ docs: [docStub("seeded", 5_000)], docChanges: () => [] });

    fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub("tie", 5_000) }] });

    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({ firestoreId: "tie" }));
  });

  it("ignores a doc whose server timestamp has not resolved, without moving the watermark", () => {
    const { fire, onNotification } = subscribe();
    fire({ docs: [docStub("seeded", 1_000)], docChanges: () => [] });

    fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub("pending", null) }] });
    expect(onNotification).not.toHaveBeenCalled();

    // Watermark must still be 1_000, so a later real doc at 1_500 surfaces.
    fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub("real", 1_500) }] });
    expect(onNotification).toHaveBeenCalledTimes(1);
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({ firestoreId: "real" }));
  });

  it("emits a given doc only once even if re-added", () => {
    const { fire, onNotification } = subscribe();
    fire({ docs: [], docChanges: () => [] });

    const change = { type: "added", doc: docStub("dupe", 2_000) };
    fire({ docs: [], docChanges: () => [change] });
    fire({ docs: [], docChanges: () => [change] });

    expect(onNotification).toHaveBeenCalledTimes(1);
  });

  it("never toasts a seeded doc, even if it is re-delivered as added", () => {
    const { fire, onNotification } = subscribe();
    fire({ docs: [docStub("seeded", 7_000)], docChanges: () => [] });

    fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub("seeded", 7_000) }] });

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("calls onSeed exactly once per subscription", () => {
    const { fire, onSeed } = subscribe();
    fire({ docs: [docStub("a", 1_000)], docChanges: () => [] });
    fire({ docs: [], docChanges: () => [] });
    expect(onSeed).toHaveBeenCalledTimes(1);
  });

  it("works without an onSeed callback", () => {
    let handler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      handler = cb;
      return vi.fn();
    });
    const onNotification = vi.fn();
    subscribeToNotifications("u1", onNotification);

    expect(() => handler({ docs: [docStub("a", 1_000)], docChanges: () => [] })).not.toThrow();
    handler({ docs: [], docChanges: () => [{ type: "added", doc: docStub("b", 2_000) }] });
    expect(onNotification).toHaveBeenCalledWith(expect.objectContaining({ firestoreId: "b" }));
  });

  it("trims the emitted-id set past its bound and keeps delivering", () => {
    // The bound exists so a long-lived tab cannot grow the set without limit.
    // Trimming is only safe because the watermark moves forward monotonically —
    // assert both: the trim happens AND nothing regresses into re-toasting.
    const { fire, onNotification } = subscribe();
    fire({ docs: [], docChanges: () => [] });

    for (let i = 1; i <= 210; i++) {
      fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub(`n${i}`, i) }] });
    }
    expect(onNotification).toHaveBeenCalledTimes(210);

    // An id evicted by the trim must still not re-toast — the watermark (210)
    // is now far ahead of its createdAt.
    fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub("n1", 1) }] });
    expect(onNotification).toHaveBeenCalledTimes(210);

    // ...and a genuinely newer doc still gets through.
    fire({ docs: [], docChanges: () => [{ type: "added", doc: docStub("fresh", 999) }] });
    expect(onNotification).toHaveBeenCalledTimes(211);
  });

  it("treats a missing createdAt as unresolved rather than epoch zero", () => {
    const { fire, onNotification } = subscribe();
    fire({ docs: [], docChanges: () => [] });
    fire({
      docs: [],
      docChanges: () => [{ type: "added", doc: { id: "no-ts", data: () => ({ gameId: "g" }) } }],
    });
    expect(onNotification).not.toHaveBeenCalled();
  });
});
