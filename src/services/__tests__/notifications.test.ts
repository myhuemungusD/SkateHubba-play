import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockAddDoc = vi.fn().mockResolvedValue({ id: "notif1" });
const mockCollection = vi.fn((...args: unknown[]) => args[1]);
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn((...args: unknown[]) => `${args[1]}/${args[2]}`);

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

import { writeNotification, _resetNotificationRateLimit } from "../notifications";

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
    const docData = mockAddDoc.mock.calls[0][1];
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
    const limitData = mockSetDoc.mock.calls[0][1];
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
