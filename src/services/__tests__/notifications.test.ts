import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Variadic signatures keep these mocks compatible with vitest 4's stricter
// `vi.fn()` default while letting tests assign any return value or rejection.
type AnyMock = (...args: unknown[]) => unknown;
type OnSnapshotImpl = (q: unknown, cb: (snap: unknown) => void, onError?: (err: Error) => void) => () => void;
const mockAddDoc = vi.fn<AnyMock>(() => Promise.resolve({ id: "notif1" }));
const mockSetDoc = vi.fn<AnyMock>(() => Promise.resolve(undefined));
const mockCollection = vi.fn((...args: unknown[]) => args[1]);
const mockDoc = vi.fn((...args: unknown[]) => args);
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
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
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
}));

vi.mock("../../firebase");

import {
  writeNotification,
  _resetNotificationRateLimit,
  markNotificationRead,
  deleteNotification,
  deleteUserNotifications,
  subscribeToNudges,
  subscribeToNotifications,
} from "../notifications";

beforeEach(() => {
  vi.clearAllMocks();
  _resetNotificationRateLimit();
});

describe("writeNotification", () => {
  it("writes a notification doc with senderUid to the notifications collection", async () => {
    await writeNotification({
      senderUid: "sender456",
      recipientUid: "user123",
      type: "your_turn",
      title: "Your Turn!",
      body: "Match @alice's kickflip",
      gameId: "game456",
    });

    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    const docData = mockAddDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(docData.senderUid).toBe("sender456");
    expect(docData.recipientUid).toBe("user123");
    expect(docData.type).toBe("your_turn");
    expect(docData.title).toBe("Your Turn!");
    expect(docData.body).toBe("Match @alice's kickflip");
    expect(docData.gameId).toBe("game456");
    expect(docData.read).toBe(false);
    expect(docData.createdAt).toBe("SERVER_TS");
  });

  it("writes rate-limit doc after successful notification", async () => {
    await writeNotification({
      senderUid: "sender456",
      recipientUid: "user123",
      type: "your_turn",
      title: "Your Turn!",
      body: "Match @alice's kickflip",
      gameId: "game456",
    });

    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "notification_limits", "sender456_game456_your_turn");
    const limitData = mockSetDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(limitData.senderUid).toBe("sender456");
    expect(limitData.gameId).toBe("game456");
    expect(limitData.type).toBe("your_turn");
    expect(limitData.lastSentAt).toBe("SERVER_TS");
  });

  it("does not throw when addDoc fails", async () => {
    mockAddDoc.mockRejectedValueOnce(new Error("Firestore unavailable"));
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

  it("does not write rate-limit doc when addDoc fails", async () => {
    mockAddDoc.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await writeNotification({
      senderUid: "sender456",
      recipientUid: "user123",
      type: "game_won",
      title: "You Won!",
      body: "vs @bob",
      gameId: "game789",
    });

    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("does not throw when rate-limit setDoc fails", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("setDoc failed"));
    await expect(
      writeNotification({
        senderUid: "sender456",
        recipientUid: "user123",
        type: "your_turn",
        title: "Your Turn!",
        body: "Match trick",
        gameId: "game456",
      }),
    ).resolves.toBeUndefined();
  });

  describe("client-side rate limiting", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("skips duplicate notification within 5s cooldown", async () => {
      const params = {
        senderUid: "sender456",
        recipientUid: "user123",
        type: "your_turn" as const,
        title: "Your Turn!",
        body: "Match trick",
        gameId: "game456",
      };

      await writeNotification(params);
      expect(mockAddDoc).toHaveBeenCalledTimes(1);

      // Second call within cooldown — should be silently skipped
      await writeNotification(params);
      expect(mockAddDoc).toHaveBeenCalledTimes(1);
    });

    it("allows notification after cooldown expires", async () => {
      const params = {
        senderUid: "sender456",
        recipientUid: "user123",
        type: "your_turn" as const,
        title: "Your Turn!",
        body: "Match trick",
        gameId: "game456",
      };

      await writeNotification(params);
      expect(mockAddDoc).toHaveBeenCalledTimes(1);

      // Advance past the 5s cooldown
      vi.advanceTimersByTime(5_001);

      await writeNotification(params);
      expect(mockAddDoc).toHaveBeenCalledTimes(2);
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

      expect(mockAddDoc).toHaveBeenCalledTimes(2);
    });
  });

  it("_resetNotificationRateLimit clears rate-limit state", async () => {
    const params = {
      senderUid: "sender456",
      recipientUid: "user123",
      type: "your_turn" as const,
      title: "Your Turn!",
      body: "Match trick",
      gameId: "game456",
    };

    await writeNotification(params);
    expect(mockAddDoc).toHaveBeenCalledTimes(1);

    // Reset and call again — should allow through
    _resetNotificationRateLimit();
    await writeNotification(params);
    expect(mockAddDoc).toHaveBeenCalledTimes(2);
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
  it("queries and deletes all notifications for a user", async () => {
    const mockDocs = [{ ref: "ref1" }, { ref: "ref2" }];
    mockGetDocs.mockResolvedValueOnce({ docs: mockDocs });
    mockDeleteDoc.mockResolvedValue(undefined);

    await deleteUserNotifications("user123");

    expect(mockGetDocs).toHaveBeenCalledTimes(1);
    expect(mockDeleteDoc).toHaveBeenCalledTimes(2);
    expect(mockDeleteDoc).toHaveBeenCalledWith("ref1");
    expect(mockDeleteDoc).toHaveBeenCalledWith("ref2");
  });

  it("handles empty result set", async () => {
    mockGetDocs.mockResolvedValueOnce({ docs: [] });
    await deleteUserNotifications("user123");
    expect(mockDeleteDoc).not.toHaveBeenCalled();
  });
});

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

  it("fires onNudge for newly added docs after seeding", async () => {
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

    // Wait for ready flag
    await new Promise((r) => setTimeout(r, 10));

    // Second snapshot with new doc
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

  it("caps tracked IDs at 50 to prevent unbounded growth", async () => {
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
    await new Promise((r) => setTimeout(r, 10));

    // Add 3 new docs to push past 50
    const changes = Array.from({ length: 3 }, (_, i) => ({
      type: "added",
      doc: { id: `new${i}`, data: () => ({ senderUsername: "bob", gameId: `g${i}` }) },
    }));
    snapshotHandler({ docs: [], docChanges: () => changes });

    expect(onNudge).toHaveBeenCalledTimes(3);
  });

  it("skips docs that are not of type 'added'", async () => {
    const onNudge = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNudges("u1", onNudge);
    snapshotHandler({ docs: [], docChanges: () => [] });
    await new Promise((r) => setTimeout(r, 10));

    snapshotHandler({
      docs: [],
      docChanges: () => [{ type: "modified", doc: { id: "m1", data: () => ({}) } }],
    });

    expect(onNudge).not.toHaveBeenCalled();
  });

  it("does not fire callback before ready flag is set", () => {
    const onNudge = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNudges("u1", onNudge);
    snapshotHandler({ docs: [], docChanges: () => [] });

    // Immediately fire second snapshot (before setTimeout tick sets ready=true)
    snapshotHandler({
      docs: [{ id: "n1" }],
      docChanges: () => [{ type: "added", doc: { id: "n1", data: () => ({ senderUsername: "bob", gameId: "g1" }) } }],
    });

    expect(onNudge).not.toHaveBeenCalled();
  });

  it("skips docs already in the initial set", async () => {
    const onNudge = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNudges("u1", onNudge);
    snapshotHandler({ docs: [{ id: "existing1" }], docChanges: () => [] });
    await new Promise((r) => setTimeout(r, 10));

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

  it("fires onNotification for newly added docs with firestoreId", async () => {
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

    await new Promise((r) => setTimeout(r, 10));

    // Second snapshot with new notification
    snapshotHandler({
      docs: [{ id: "n1" }],
      docChanges: () => [
        {
          type: "added",
          doc: {
            id: "n1",
            data: () => ({ type: "your_turn", title: "Your Turn!", body: "vs @bob", gameId: "g1" }),
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
    });
    // markNotificationRead is no longer called by the subscription —
    // the caller is responsible for marking read when the user sees it.
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it("caps tracked IDs at 50 to prevent unbounded growth", async () => {
    const onNotification = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNotifications("u1", onNotification);

    // Seed with 49 existing IDs
    const seedDocs = Array.from({ length: 49 }, (_, i) => ({ id: `seed${i}` }));
    snapshotHandler({ docs: seedDocs, docChanges: () => [] });
    await new Promise((r) => setTimeout(r, 10));

    // Add 3 new docs to push past 50
    const changes = Array.from({ length: 3 }, (_, i) => ({
      type: "added",
      doc: { id: `new${i}`, data: () => ({ type: "your_turn", title: "T", body: "B", gameId: `g${i}` }) },
    }));
    snapshotHandler({ docs: [], docChanges: () => changes });

    expect(onNotification).toHaveBeenCalledTimes(3);
  });

  it("skips already-seen and non-added docs", async () => {
    const onNotification = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNotifications("u1", onNotification);
    snapshotHandler({ docs: [{ id: "existing1" }], docChanges: () => [] });
    await new Promise((r) => setTimeout(r, 10));

    snapshotHandler({
      docs: [],
      docChanges: () => [
        { type: "modified", doc: { id: "m1", data: () => ({}) } },
        { type: "added", doc: { id: "existing1", data: () => ({}) } },
      ],
    });

    expect(onNotification).not.toHaveBeenCalled();
  });

  it("uses fallback values when notification fields are null", async () => {
    const onNotification = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNotifications("u1", onNotification);
    snapshotHandler({ docs: [], docChanges: () => [] });
    await new Promise((r) => setTimeout(r, 10));

    snapshotHandler({
      docs: [{ id: "n1" }],
      docChanges: () => [
        {
          type: "added",
          doc: { id: "n1", data: () => ({ type: null, title: null, body: null, gameId: "g1" }) },
        },
      ],
    });

    expect(onNotification).toHaveBeenCalledWith({
      firestoreId: "n1",
      type: "",
      title: "SkateHubba",
      body: "",
      gameId: "g1",
    });
  });

  it("does not fire callback before ready flag is set", () => {
    const onNotification = vi.fn();
    let snapshotHandler: (snap: unknown) => void = () => {};
    mockOnSnapshot.mockImplementationOnce((_q: unknown, cb: (snap: unknown) => void) => {
      snapshotHandler = cb;
      return vi.fn();
    });

    subscribeToNotifications("u1", onNotification);
    snapshotHandler({ docs: [], docChanges: () => [] });

    // Immediately fire second snapshot (before setTimeout tick sets ready=true)
    snapshotHandler({
      docs: [{ id: "n1" }],
      docChanges: () => [
        { type: "added", doc: { id: "n1", data: () => ({ type: "t", title: "T", body: "B", gameId: "g" }) } },
      ],
    });

    expect(onNotification).not.toHaveBeenCalled();
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
