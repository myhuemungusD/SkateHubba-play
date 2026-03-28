import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/firestore ─────────────────── */

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockAddDoc = vi.fn().mockResolvedValue({ id: "nudge1" });
const mockDoc = vi.fn((_db: unknown, ...segments: string[]) => segments.join("/"));
const mockCollection = vi.fn((_db: unknown, name: string) => name);
const mockServerTimestamp = vi.fn(() => "SERVER_TS");
const mockOnSnapshot = vi.fn(() => vi.fn());
const mockQuery = vi.fn((...args: unknown[]) => args);
const mockWhere = vi.fn((...args: unknown[]) => args);
const mockOrderBy = vi.fn((...args: unknown[]) => args);
const mockLimit = vi.fn((...args: unknown[]) => args);

vi.mock("firebase/firestore", () => ({
  addDoc: (...args: unknown[]) => mockAddDoc(...args),
  collection: (...args: unknown[]) => mockCollection(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => mockServerTimestamp(),
  onSnapshot: (...args: unknown[]) => mockOnSnapshot(...args),
  query: (...args: unknown[]) => mockQuery(...args),
  where: (...args: unknown[]) => mockWhere(...args),
  orderBy: (...args: unknown[]) => mockOrderBy(...args),
  limit: (...args: unknown[]) => mockLimit(...args),
}));

vi.mock("../../firebase");

/* ── tests ───────────────────────────────────── */

import { sendNudge, canNudge, subscribeToNudges } from "../nudge";

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

describe("canNudge", () => {
  it("returns true when no previous nudge exists", () => {
    expect(canNudge("g1")).toBe(true);
  });

  it("returns false when nudged recently", () => {
    localStorage.setItem("nudge_g1", String(Date.now()));
    expect(canNudge("g1")).toBe(false);
  });

  it("returns true after cooldown expires", () => {
    localStorage.setItem("nudge_g1", String(Date.now() - 1 * 60 * 60 * 1000 - 1));
    expect(canNudge("g1")).toBe(true);
  });
});

describe("sendNudge", () => {
  const params = {
    gameId: "g1",
    senderUid: "u1",
    senderUsername: "sk8r",
    recipientUid: "u2",
  };

  it("writes rate-limit doc and nudge doc to Firestore", async () => {
    await sendNudge(params);

    // Rate-limit doc
    expect(mockSetDoc).toHaveBeenCalledWith("nudge_limits/u1_g1", {
      senderUid: "u1",
      gameId: "g1",
      lastNudgedAt: "SERVER_TS",
    });

    // Nudge doc
    expect(mockAddDoc).toHaveBeenCalledWith("nudges", {
      senderUid: "u1",
      senderUsername: "sk8r",
      recipientUid: "u2",
      gameId: "g1",
      createdAt: "SERVER_TS",
      delivered: false,
    });
  });

  it("records timestamp in localStorage after success", async () => {
    await sendNudge(params);
    const stored = parseInt(localStorage.getItem("nudge_g1") || "0", 10);
    expect(Date.now() - stored).toBeLessThan(1000);
  });

  it("throws when nudged within cooldown", async () => {
    localStorage.setItem("nudge_g1", String(Date.now()));
    await expect(sendNudge(params)).rejects.toThrow("once per hour");
  });

  it("does not write to localStorage when cooldown check fails", async () => {
    localStorage.setItem("nudge_g1", String(Date.now()));
    await expect(sendNudge(params)).rejects.toThrow();
    // Timestamp should still be the original, not updated
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe("subscribeToNudges", () => {
  it("calls onSnapshot with a query for recipient nudges", () => {
    const callback = vi.fn();
    subscribeToNudges("u2", callback);

    expect(mockCollection).toHaveBeenCalledWith(expect.anything(), "nudges");
    expect(mockWhere).toHaveBeenCalledWith("recipientUid", "==", "u2");
    expect(mockOrderBy).toHaveBeenCalledWith("createdAt", "desc");
    expect(mockLimit).toHaveBeenCalledWith(5);
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
  });

  it("returns the unsubscribe function from onSnapshot", () => {
    const mockUnsub = vi.fn();
    mockOnSnapshot.mockReturnValueOnce(mockUnsub);

    const unsub = subscribeToNudges("u2", vi.fn());
    expect(unsub).toBe(mockUnsub);
  });
});
