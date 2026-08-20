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
const mockGetDoc = vi.fn<AnyMock>(() => Promise.resolve({ exists: () => false, data: () => undefined }));

vi.mock("firebase/firestore", () => ({
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  getDoc: (...args: unknown[]) => mockGetDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
  writeBatch: (...args: unknown[]) => mockWriteBatch(...args),
}));

vi.mock("../../firebase");

const mockDispatchPush = vi.fn<AnyMock>(() => Promise.resolve(undefined));
vi.mock("../pushDispatch", () => ({
  dispatchPushNotification: (...args: unknown[]) => mockDispatchPush(...args),
}));

/* ── tests ───────────────────────────────────── */

import { sendNudge, canNudge, getServerNudgeCooldownMs, NUDGE_COOLDOWN_MS } from "../nudge";
import { _resetNotificationRateLimit } from "../notifications";

/** Build a rejection shaped like a FirebaseError (a `code` field, not just a message). */
function firebaseError(code: string): Error & { code: string } {
  return Object.assign(new Error(`FIREBASE: ${code}`), { code });
}

beforeEach(() => {
  vi.clearAllMocks();
  batchSetCalls.length = 0;
  localStorage.clear();
  // sendNudge now routes the bell entry through writeNotification, which keeps
  // a module-level 5s cooldown map. Without this reset the second test in the
  // file would silently exercise the suppressed branch.
  _resetNotificationRateLimit();
  mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
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

    // Two batches now: the nudge batch (nudge + nudge_limits) and the bell
    // batch writeNotification commits afterwards (notification +
    // notification_limits). Each is independently atomic, which is what the
    // companion-write rules require.
    expect(mockWriteBatch).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
    expect(mockBatchSet).toHaveBeenCalledTimes(4);

    const nudgeCall = batchSetCalls.find((c) => c.ref === "nudges/auto-id");
    expect(nudgeCall?.data).toEqual({
      senderUid: "u1",
      senderUsername: "sk8r",
      recipientUid: "u2",
      gameId: "g1",
      createdAt: "SERVER_TS",
    });
    // `delivered` was vestigial — nothing ever flipped it, and no reader
    // consulted it. It must not come back.
    expect(nudgeCall?.data).not.toHaveProperty("delivered");

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
    mockBatchCommit.mockRejectedValueOnce(firebaseError("permission-denied"));
    await expect(sendNudge(params)).rejects.toThrow("once per hour");
    expect(localStorage.getItem("nudge_u1_g1")).toBeNull();
  });

  it("maps a rules rejection to the cooldown copy, never the raw Firebase string", async () => {
    // A cross-device cooldown collision is the overwhelmingly likely
    // permission-denied here: localStorage on THIS device says the user may
    // nudge, /nudge_limits on the server disagrees.
    mockBatchCommit.mockRejectedValueOnce(firebaseError("permission-denied"));
    await expect(sendNudge(params)).rejects.toThrow("You can only nudge once per hour per game");
  });

  it("maps a non-permission failure to the generic copy", async () => {
    mockBatchCommit.mockRejectedValueOnce(firebaseError("unavailable"));
    await expect(sendNudge(params)).rejects.toThrow("Couldn't send nudge. Try again.");
  });

  it("maps a non-object rejection to the generic copy", async () => {
    mockBatchCommit.mockRejectedValueOnce("boom");
    await expect(sendNudge(params)).rejects.toThrow("Couldn't send nudge. Try again.");
  });

  it("dispatches an OS push after the batch commits", async () => {
    await sendNudge(params);
    expect(mockDispatchPush).toHaveBeenCalledWith({
      senderUid: "u1",
      recipientUid: "u2",
      type: "nudge",
      title: "You got nudged!",
      body: "@sk8r is waiting for your move",
      gameId: "g1",
    });
  });

  it("leaves a persistent bell entry with EXACTLY the keys the nudge rule allows", async () => {
    // The /notifications create rule validates type=='nudge' docs against an
    // exact key set. An extra field here is a rules rejection in production,
    // and the bell silently loses nudges again.
    await sendNudge(params);
    const bell = batchSetCalls
      .map((c) => c.data as Record<string, unknown>)
      .find((d) => d?.type === "nudge" && "read" in d);
    expect(bell).toBeDefined();
    expect(Object.keys(bell as Record<string, unknown>).sort()).toEqual(
      ["body", "createdAt", "gameId", "read", "recipientUid", "senderUid", "title", "type"].sort(),
    );
    expect(bell).toMatchObject({ recipientUid: "u2", senderUid: "u1", read: false, gameId: "g1" });
  });

  it("writes the notification_limits cooldown companion alongside the bell entry", async () => {
    await sendNudge(params);
    const limit = batchSetCalls.find((c) => c.ref === "notification_limits/u1_g1_nudge");
    expect(limit?.data).toMatchObject({ senderUid: "u1", gameId: "g1", type: "nudge", lastSentAt: "SERVER_TS" });
  });

  it("does not write a bell entry when the nudge batch commit fails", async () => {
    mockBatchCommit.mockRejectedValueOnce(firebaseError("permission-denied"));
    await expect(sendNudge(params)).rejects.toThrow();
    expect(batchSetCalls.some((c) => c.ref.startsWith("notification_limits/"))).toBe(false);
  });

  it("does not dispatch a push when the batch commit fails", async () => {
    mockBatchCommit.mockRejectedValueOnce(firebaseError("permission-denied"));
    await expect(sendNudge(params)).rejects.toThrow();
    expect(mockDispatchPush).not.toHaveBeenCalled();
  });

  it("does not dispatch a push when the local cooldown blocks the send", async () => {
    localStorage.setItem("nudge_u1_g1", String(Date.now()));
    await expect(sendNudge(params)).rejects.toThrow();
    expect(mockDispatchPush).not.toHaveBeenCalled();
  });

  it("resolves even when the push dispatch rejects — delivery never blocks the nudge", async () => {
    mockDispatchPush.mockRejectedValueOnce(new Error("dispatch exploded"));
    await expect(sendNudge(params)).resolves.toBeUndefined();
    expect(localStorage.getItem("nudge_u1_g1")).not.toBeNull();
  });
});

describe("getServerNudgeCooldownMs", () => {
  it("returns 0 when no limit doc exists", async () => {
    await expect(getServerNudgeCooldownMs("g1", "u1")).resolves.toBe(0);
  });

  it("returns the remaining window when still cooling down", async () => {
    const halfAgo = Date.now() - NUDGE_COOLDOWN_MS / 2;
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ lastNudgedAt: { toMillis: () => halfAgo } }),
    });
    const remaining = await getServerNudgeCooldownMs("g1", "u1");
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThanOrEqual(NUDGE_COOLDOWN_MS / 2);
  });

  it("returns 0 once the window has elapsed", async () => {
    mockGetDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ lastNudgedAt: { toMillis: () => Date.now() - NUDGE_COOLDOWN_MS - 1 } }),
    });
    await expect(getServerNudgeCooldownMs("g1", "u1")).resolves.toBe(0);
  });

  it("returns 0 when lastNudgedAt has not resolved yet", async () => {
    mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ lastNudgedAt: null }) });
    await expect(getServerNudgeCooldownMs("g1", "u1")).resolves.toBe(0);
  });

  it("returns 0 when the read throws — a transient error must not brick the button", async () => {
    mockGetDoc.mockRejectedValueOnce(firebaseError("unavailable"));
    await expect(getServerNudgeCooldownMs("g1", "u1")).resolves.toBe(0);
  });

  it("reads the deterministic senderUid_gameId limit doc", async () => {
    await getServerNudgeCooldownMs("g1", "u1");
    expect(mockGetDoc).toHaveBeenCalledWith("nudge_limits/u1_g1");
  });
});
