import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddDoc = vi.fn().mockResolvedValue({ id: "notif1" });
const mockCollection = vi.fn((...args: unknown[]) => args[1]);

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

import { writeNotification } from "../notifications";

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
