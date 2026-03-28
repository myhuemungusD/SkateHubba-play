import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddDoc = vi.fn().mockResolvedValue({ id: "notif1" });
const mockDeleteDoc = vi.fn().mockResolvedValue(undefined);
const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockOnSnapshot = vi.fn(() => vi.fn());
const mockCollection = vi.fn((...args: unknown[]) => args[1]);
const mockDoc = vi.fn((_db: unknown, ...segments: string[]) => segments.join("/"));
const mockQuery = vi.fn((...args: unknown[]) => args);
const mockWhere = vi.fn((...args: unknown[]) => args);
const mockOrderBy = vi.fn((...args: unknown[]) => args);
const mockLimit = vi.fn((...args: unknown[]) => args);

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  deleteDoc: (...args: unknown[]) => mockDeleteDoc(...args),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

import {
  writeNotification,
  subscribeToUnreadNotifications,
  markNotificationRead,
  deleteNotification,
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

describe("subscribeToUnreadNotifications", () => {
  it("calls onSnapshot with a query for unread notifications", () => {
    const callback = vi.fn();
    subscribeToUnreadNotifications("user123", callback);

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "notifications");
    expect(mockWhere).toHaveBeenCalledWith("recipientUid", "==", "user123");
    expect(mockWhere).toHaveBeenCalledWith("read", "==", false);
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockLimit).toHaveBeenCalledWith(10);
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
  });

  it("returns the unsubscribe function from onSnapshot", () => {
    const mockUnsub = vi.fn();
    mockOnSnapshot.mockReturnValueOnce(mockUnsub);

    const unsub = subscribeToUnreadNotifications("user123", vi.fn());
    expect(unsub).toBe(mockUnsub);
  });
});

describe("markNotificationRead", () => {
  it("calls updateDoc with read: true", async () => {
    await markNotificationRead("notif123");

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "notifications", "notif123");
    expect(mockUpdateDoc).toHaveBeenCalledWith("notifications/notif123", { read: true });
  });
});

describe("deleteNotification", () => {
  it("calls deleteDoc on the notification document", async () => {
    await deleteNotification("notif456");

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "notifications", "notif456");
    expect(mockDeleteDoc).toHaveBeenCalledWith("notifications/notif456");
  });
});
