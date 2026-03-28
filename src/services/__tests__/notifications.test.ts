import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddDoc = vi.fn().mockResolvedValue({ id: "notif1" });
const mockCollection = vi.fn((...args: unknown[]) => args[1]);
const mockDoc = vi.fn((...args: unknown[]) => args);
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDocs = vi.fn();
const mockOnSnapshot = vi.fn(() => vi.fn());
const mockQuery = vi.fn((...args: unknown[]) => args);
const mockWhere = vi.fn((...args: unknown[]) => args);
const mockOrderBy = vi.fn((...args: unknown[]) => args);
const mockLimit = vi.fn((...args: unknown[]) => args);

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  getDocs: (...args: unknown[]) => mockGetDocs(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

import {
  writeNotification,
  markNotificationRead,
  deleteNotification,
  deleteUserNotifications,
  subscribeToNudges,
  subscribeToNotifications,
} from "../notifications";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("writeNotification", () => {
  it("writes a notification doc to the notifications collection", async () => {
    await writeNotification({
      recipientUid: "user123",
      type: "your_turn",
      title: "Your Turn!",
      body: "Match @alice's kickflip",
      gameId: "game456",
    });

    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    const docData = mockAddDoc.mock.calls[0][1];
    expect(docData.recipientUid).toBe("user123");
    expect(docData.type).toBe("your_turn");
    expect(docData.title).toBe("Your Turn!");
    expect(docData.body).toBe("Match @alice's kickflip");
    expect(docData.gameId).toBe("game456");
    expect(docData.read).toBe(false);
    expect(docData.createdAt).toBe("SERVER_TS");
  });

  it("does not throw when addDoc fails", async () => {
    mockAddDoc.mockRejectedValueOnce(new Error("Firestore unavailable"));
    await expect(
      writeNotification({
        recipientUid: "user123",
        type: "game_won",
        title: "You Won!",
        body: "vs @bob",
        gameId: "game789",
      }),
    ).resolves.toBeUndefined();
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

  it("fires onNotification for newly added docs and marks them read", async () => {
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
      type: "your_turn",
      title: "Your Turn!",
      body: "vs @bob",
      gameId: "g1",
    });
    // markNotificationRead is called (via updateDoc)
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
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
});
