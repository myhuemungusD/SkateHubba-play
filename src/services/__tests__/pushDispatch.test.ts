import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── firestore mocks ─────────────────────────── */

type AnyMock = (...args: unknown[]) => unknown;
const mockGetDoc = vi.fn<AnyMock>();
const mockAddDoc = vi.fn<AnyMock>(() => Promise.resolve({ id: "dispatch-id" }));
// doc(db, "pushTargets", uid)  → joined path so getDoc-call args are introspectable
const mockDoc = vi.fn((...args: unknown[]) => (args.slice(1) as string[]).join("/"));
// collection(db, "push_dispatch")  → join args[1:] so addDoc-call args are introspectable
const mockCollection = vi.fn((...args: unknown[]) => (args.slice(1) as string[]).join("/"));

vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase");

import {
  PUSH_DISPATCH_COLLECTION,
  PUSH_TARGETS_COLLECTION,
  createPushDispatchOutbox,
  dispatchPushNotification,
  drainPushDispatchOutbox,
  getRecipientPushTokens,
  resetPushDispatchOutbox,
} from "../pushDispatch";

beforeEach(() => {
  vi.clearAllMocks();
});

function snapshot(exists: boolean, data?: Record<string, unknown>) {
  return {
    exists: () => exists,
    data: () => data ?? {},
  };
}

/* ── getRecipientPushTokens ──────────────────── */

describe("getRecipientPushTokens", () => {
  it("returns an empty array when the mirror doc does not exist", async () => {
    mockGetDoc.mockResolvedValue(snapshot(false));
    const tokens = await getRecipientPushTokens("u-no-mirror");
    expect(tokens).toEqual([]);
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), PUSH_TARGETS_COLLECTION, "u-no-mirror");
  });

  it("returns the deduplicated string tokens stored on the mirror", async () => {
    mockGetDoc.mockResolvedValue(snapshot(true, { tokens: ["t1", "t2"] }));
    const tokens = await getRecipientPushTokens("u1");
    expect(tokens).toEqual(["t1", "t2"]);
  });

  it("filters non-string and empty entries (defensive against legacy or malicious writers)", async () => {
    mockGetDoc.mockResolvedValue(snapshot(true, { tokens: ["t1", "", null, 42, "t2"] as unknown[] }));
    const tokens = await getRecipientPushTokens("u1");
    expect(tokens).toEqual(["t1", "t2"]);
  });

  it("returns [] when the tokens field is missing or wrong-typed", async () => {
    mockGetDoc.mockResolvedValue(snapshot(true, { tokens: "not-an-array" as unknown }));
    expect(await getRecipientPushTokens("u1")).toEqual([]);

    mockGetDoc.mockResolvedValue(snapshot(true, {}));
    expect(await getRecipientPushTokens("u1")).toEqual([]);
  });

  it("returns [] and swallows on Firestore read errors so the caller is never blocked", async () => {
    mockGetDoc.mockRejectedValue(new Error("permission-denied"));
    expect(await getRecipientPushTokens("u1")).toEqual([]);
  });
});

/* ── dispatchPushNotification ────────────────── */

describe("dispatchPushNotification", () => {
  const baseParams = {
    senderUid: "alice",
    recipientUid: "bob",
    type: "your_turn" as const,
    title: "Your Turn!",
    body: "Match the trick",
    gameId: "game-1",
  };

  it("no-ops without writing when the recipient has no registered tokens", async () => {
    mockGetDoc.mockResolvedValue(snapshot(false));
    await dispatchPushNotification(baseParams);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });

  it("writes a /push_dispatch doc in the extension's schema when tokens exist", async () => {
    mockGetDoc.mockResolvedValue(snapshot(true, { tokens: ["t1", "t2"] }));
    await dispatchPushNotification(baseParams);

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), PUSH_DISPATCH_COLLECTION);
    expect(mockAddDoc).toHaveBeenCalledTimes(1);
    const [, payload] = mockAddDoc.mock.calls[0] as unknown[];
    expect(payload).toMatchObject({
      tokens: ["t1", "t2"],
      notification: { title: "Your Turn!", body: "Match the trick" },
      data: { gameId: "game-1", type: "your_turn", click_action: "/?game=game-1" },
      senderUid: "alice",
      recipientUid: "bob",
      gameId: "game-1",
      type: "your_turn",
      createdAt: "SERVER_TS",
    });
  });

  it("dedupes tokens and caps the dispatch at ≤10 entries to bound FCM fan-out", async () => {
    // 12 distinct tokens + duplicates: dispatch should carry exactly 10 unique entries.
    const tokens = Array.from({ length: 12 }, (_, i) => `t${i}`).concat("t0", "t1");
    mockGetDoc.mockResolvedValue(snapshot(true, { tokens }));
    await dispatchPushNotification(baseParams);

    const [, payload] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    expect((payload.tokens as string[]).length).toBe(10);
    expect(new Set(payload.tokens as string[]).size).toBe(10);
  });

  it("truncates title and body to the firestore-rules size caps", async () => {
    mockGetDoc.mockResolvedValue(snapshot(true, { tokens: ["t1"] }));
    const longTitle = "A".repeat(200);
    const longBody = "B".repeat(500);
    await dispatchPushNotification({ ...baseParams, title: longTitle, body: longBody });

    const [, payload] = mockAddDoc.mock.calls[0] as [unknown, Record<string, unknown>];
    const notif = payload.notification as { title: string; body: string };
    expect(notif.title.length).toBe(80);
    expect(notif.body.length).toBe(200);
  });

  it("swallows addDoc failures so the originating game action is never blocked", async () => {
    mockGetDoc.mockResolvedValue(snapshot(true, { tokens: ["t1"] }));
    mockAddDoc.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(dispatchPushNotification(baseParams)).resolves.toBeUndefined();
  });
});

/* ── outbox ─────────────────────────────────── */

// Shared param factory keeps the outbox tests parametrized and dodges the
// test-duplication gate (two near-identical params blocks would fail it).
const stub = (recipientUid = "b") => ({
  senderUid: "a",
  recipientUid,
  type: "your_turn" as const,
  title: "t",
  body: "b",
  gameId: "g",
});

describe("push dispatch outbox", () => {
  it("starts empty and accepts staged params", () => {
    const outbox = createPushDispatchOutbox();
    expect(outbox.staged).toEqual([]);
    outbox.staged.push(stub());
    expect(outbox.staged.length).toBe(1);
  });

  it("resetPushDispatchOutbox clears prior entries — needed for tx retry safety", () => {
    const outbox = createPushDispatchOutbox();
    outbox.staged.push(stub());
    resetPushDispatchOutbox(outbox);
    expect(outbox.staged).toEqual([]);
  });

  it("drainPushDispatchOutbox fires every staged dispatch and empties the queue", async () => {
    mockGetDoc.mockResolvedValue(snapshot(true, { tokens: ["t1"] }));
    const outbox = createPushDispatchOutbox();
    outbox.staged.push(stub("b"), stub("c"));
    await drainPushDispatchOutbox(outbox);
    expect(mockAddDoc).toHaveBeenCalledTimes(2);
    expect(outbox.staged).toEqual([]);
  });

  it("drainPushDispatchOutbox is a no-op when nothing is staged", async () => {
    const outbox = createPushDispatchOutbox();
    await drainPushDispatchOutbox(outbox);
    expect(mockAddDoc).not.toHaveBeenCalled();
  });
});
