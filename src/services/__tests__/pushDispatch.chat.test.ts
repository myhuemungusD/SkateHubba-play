import { describe, it, expect, vi, beforeEach } from "vitest";

const f = vi.hoisted(() => ({
  getDoc: vi.fn(),
  set: vi.fn(),
  commit: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: (...a: unknown[]) => (a.length === 1 ? { auto: a[0] } : (a.slice(1) as string[]).join("/")),
  collection: (...a: unknown[]) => (a.slice(1) as string[]).join("/"),
  getDoc: (...a: unknown[]) => f.getDoc(...a),
  serverTimestamp: () => "TS",
  writeBatch: () => ({ set: f.set, commit: f.commit }),
}));
vi.mock("../../firebase");
vi.mock("../logger", () => ({ logger: { warn: f.warn, info: vi.fn(), error: vi.fn() } }));

import { CHAT_PUSH_TYPE, dispatchChatPushNotification } from "../pushDispatch";

const params = { senderUid: "a", recipientUid: "b", spotId: "s1", title: "T", body: "B" };

beforeEach(() => {
  vi.clearAllMocks();
  f.commit.mockResolvedValue(undefined);
});

describe("dispatchChatPushNotification", () => {
  it("returns false with no tokens", async () => {
    f.getDoc.mockResolvedValue({ exists: () => false, data: () => ({}) });
    expect(await dispatchChatPushNotification(params)).toBe(false);
    expect(f.set).not.toHaveBeenCalled();
  });

  it("writes the dispatch doc and cooldown anchor in one batch", async () => {
    f.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ tokens: ["t1", "t1", "t2"] }) });
    expect(await dispatchChatPushNotification(params)).toBe(true);
    expect(f.set).toHaveBeenCalledTimes(2);
    expect(f.set.mock.calls[0][1]).toMatchObject({
      tokens: ["t1", "t2"],
      data: { spotId: "s1", type: CHAT_PUSH_TYPE, click_action: "/spots/s1" },
      recipientUid: "b",
    });
    expect(f.set.mock.calls[1][0]).toContain("s1");
    expect(f.set.mock.calls[1][1]).toEqual({ recipientUid: "b", lastSenderUid: "a", lastSentAt: "TS" });
  });

  it("resolves false when the batch is rejected (cooldown)", async () => {
    f.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ tokens: ["t1"] }) });
    f.commit.mockRejectedValue(new Error("permission-denied"));
    expect(await dispatchChatPushNotification(params)).toBe(false);
    expect(f.warn).toHaveBeenCalledWith("chat_push_dispatch_write_failed", expect.anything());
  });
});
