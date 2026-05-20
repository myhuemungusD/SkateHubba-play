import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ─────────────────── */

type AnyMock = (...args: unknown[]) => unknown;
type BatchSetCall = { ref: string; data: unknown };
const batchSetCalls: BatchSetCall[] = [];
const mockBatchCommit = vi.fn<AnyMock>(() => Promise.resolve(undefined));
const mockBatchSet = vi.fn<AnyMock>((...args: unknown[]) => {
  batchSetCalls.push({ ref: String(args[0]), data: args[1] });
});
const mockWriteBatch = vi.fn<AnyMock>(() => ({
  set: mockBatchSet,
  commit: mockBatchCommit,
}));
// `doc(db, path, segment)` and `doc(collectionRef)` both flow through here. The
// service either passes (db, "nudge_limits", id) or (collectionRef-from-collection())
// — joining the trailing args with "/" reconstructs a stable string ref for assertions.
const mockDoc = vi.fn<AnyMock>((..._args) => {
  // doc(collectionRef) → collectionRef path ("nudges") with auto-id stub
  if (_args.length === 1) return `${String(_args[0])}/auto-id`;
  return (_args.slice(1) as string[]).join("/");
});
const mockCollection = vi.fn<AnyMock>((..._args) => _args[1]);
const mockServerTimestamp = vi.fn(() => "SERVER_TS");

vi.mock("firebase/firestore", () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
}));

vi.mock("../../firebase");

/* ── tests ───────────────────────────────────── */

import { sendNudge, canNudge } from "../nudge";

beforeEach(() => {
  vi.clearAllMocks();
  batchSetCalls.length = 0;
  localStorage.clear();
});

describe("canNudge", () => {
  it("returns true when no previous nudge exists", () => {
    expect(canNudge("g1", "u1")).toBe(true);
  });

  it("returns false when nudged recently", () => {
    localStorage.setItem("nudge_u1_g1", String(Date.now()));
    expect(canNudge("g1", "u1")).toBe(false);
  });

  it("returns true after cooldown expires", () => {
    localStorage.setItem("nudge_u1_g1", String(Date.now() - 1 * 60 * 60 * 1000 - 1));
    expect(canNudge("g1", "u1")).toBe(true);
  });
});

describe("sendNudge", () => {
  const params = {
    gameId: "g1",
    senderUid: "u1",
    senderUsername: "sk8r",
    recipientUid: "u2",
  };

  it("commits the nudge and rate-limit doc atomically in a single writeBatch", async () => {
    await sendNudge(params);

    expect(mockWriteBatch).toHaveBeenCalledTimes(1);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);

    const nudgeCall = batchSetCalls.find((c) => c.ref === "nudges/auto-id");
    expect(nudgeCall?.data).toEqual({
      senderUid: "u1",
      senderUsername: "sk8r",
      recipientUid: "u2",
      gameId: "g1",
      createdAt: "SERVER_TS",
      delivered: false,
    });

    const limitCall = batchSetCalls.find((c) => c.ref === "nudge_limits/u1_g1");
    expect(limitCall?.data).toEqual({
      senderUid: "u1",
      gameId: "g1",
      lastNudgedAt: "SERVER_TS",
    });
  });

  it("records timestamp in localStorage after success", async () => {
    await sendNudge(params);
    const stored = parseInt(localStorage.getItem("nudge_u1_g1") || "0", 10);
    expect(Date.now() - stored).toBeLessThan(1000);
  });

  it("throws when nudged within cooldown", async () => {
    localStorage.setItem("nudge_u1_g1", String(Date.now()));
    await expect(sendNudge(params)).rejects.toThrow("once per hour");
  });

  it("does not commit a batch when cooldown check fails", async () => {
    localStorage.setItem("nudge_u1_g1", String(Date.now()));
    await expect(sendNudge(params)).rejects.toThrow();
    expect(mockWriteBatch).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it("does not record localStorage timestamp when batch commit fails", async () => {
    mockBatchCommit.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(sendNudge(params)).rejects.toThrow("permission-denied");
    expect(localStorage.getItem("nudge_u1_g1")).toBeNull();
  });
});
