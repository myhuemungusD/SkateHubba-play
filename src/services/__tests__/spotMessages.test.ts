import { describe, it, expect, vi, beforeEach } from "vitest";

const f = vi.hoisted(() => ({
  set: vi.fn(),
  commit: vi.fn(),
  getDoc: vi.fn(),
  getDocs: vi.fn(),
  addDoc: vi.fn(),
  setDoc: vi.fn(),
  onSnapshot: vi.fn(),
  capture: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  collection: (...a: unknown[]) => ({ path: (a.slice(1) as string[]).join("/") }),
  doc: (...a: unknown[]) => (a.length === 1 ? { id: "new-id" } : { path: (a.slice(1) as string[]).join("/") }),
  addDoc: (...a: unknown[]) => f.addDoc(...a),
  query: (...a: unknown[]) => a,
  orderBy: (...a: unknown[]) => ["orderBy", ...a],
  limit: (n: number) => ["limit", n],
  where: (...a: unknown[]) => ["where", ...a],
  onSnapshot: (...a: unknown[]) => f.onSnapshot(...a),
  serverTimestamp: () => "TS",
  getDoc: (...a: unknown[]) => f.getDoc(...a),
  getDocs: (...a: unknown[]) => f.getDocs(...a),
  setDoc: (...a: unknown[]) => f.setDoc(...a),
  writeBatch: () => ({ set: f.set, commit: f.commit }),
}));
vi.mock("../../firebase");
vi.mock("../../lib/sentry", () => ({ captureException: f.capture, addBreadcrumb: vi.fn() }));

import {
  _resetMessageRateLimit,
  fetchPendingMessageReports,
  hideSpotMessage,
  reportSpotMessage,
  sendSpotMessage,
  subscribeToSpotMessages,
  unhideSpotMessage,
} from "../spotMessages";

const SPOT = "123e4567-e89b-12d3-a456-426614174000";
const ts = (d: Date) => ({ toDate: () => d });

beforeEach(() => {
  vi.clearAllMocks();
  _resetMessageRateLimit();
  f.commit.mockResolvedValue(undefined);
});

describe("sendSpotMessage", () => {
  it("validates input", async () => {
    await expect(sendSpotMessage({ spotId: "bad", userId: "u", content: "hi" })).rejects.toThrow("Invalid spot ID");
    await expect(sendSpotMessage({ spotId: SPOT, userId: "u", content: "  " })).rejects.toThrow("empty");
    await expect(sendSpotMessage({ spotId: SPOT, userId: "u", content: "x".repeat(501) })).rejects.toThrow(
      "500 characters",
    );
  });

  it("sends, then rate-limits the next send", async () => {
    const m = await sendSpotMessage({ spotId: SPOT, userId: "u", content: " hey " });
    expect(m).toMatchObject({ id: "new-id", content: "hey", isHidden: false, hiddenReason: undefined });
    expect(f.set).toHaveBeenCalledTimes(2);
    await expect(sendSpotMessage({ spotId: SPOT, userId: "u", content: "again" })).rejects.toThrow(/Please wait/);
  });

  it("hides filtered messages", async () => {
    const m = await sendSpotMessage({ spotId: SPOT, userId: "u", content: "click here" });
    expect(m).toMatchObject({ isHidden: true, hiddenReason: "word_filter" });
    expect(f.set.mock.calls[0][1]).toMatchObject({ hiddenReason: "word_filter" });
  });

  it("reports and rethrows write failures", async () => {
    f.commit.mockRejectedValue(new Error("denied"));
    await expect(sendSpotMessage({ spotId: SPOT, userId: "u", content: "hi" })).rejects.toThrow("denied");
    expect(f.capture).toHaveBeenCalled();
  });
});

describe("subscribeToSpotMessages", () => {
  it("rejects a bad spot id", () => {
    expect(() => subscribeToSpotMessages({ spotId: "x", onMessages: vi.fn() })).toThrow("Invalid spot ID");
  });

  it("parses docs, skips malformed ones and handles errors", () => {
    const onMessages = vi.fn();
    const onError = vi.fn();
    subscribeToSpotMessages({ spotId: SPOT, onMessages, onError });
    const [, next, error] = f.onSnapshot.mock.calls[0];
    const d = new Date("2026-01-01T00:00:00Z");
    next({
      docs: [
        { id: "a", data: () => ({ userId: "u", content: "c", isHidden: false, createdAt: ts(d) }) },
        { id: "b", data: () => ({ userId: "u", content: "c", isHidden: true, hiddenReason: "reported" }) },
        {
          id: "c",
          data: () => ({
            userId: "u",
            content: "c",
            isHidden: true,
            hiddenReason: "nope",
            createdAt: ts(new Date(NaN)),
          }),
        },
        { id: "d", data: () => ({ userId: "u", content: "c", isHidden: false, createdAt: { toDate: 1 } }) },
        { id: "bad", data: () => ({ userId: 1 }) },
      ],
    });
    const msgs = onMessages.mock.calls[0][0];
    expect(msgs.map((m: { id: string }) => m.id)).toEqual(["a", "b", "c", "d"]);
    expect(msgs[0].createdAt).toBe(d.toISOString());
    expect(msgs[1].hiddenReason).toBe("reported");
    expect(msgs[2].hiddenReason).toBeUndefined();
    error(new Error("x"));
    expect(onError).toHaveBeenCalled();
  });

  it("captures errors when no onError is given", () => {
    subscribeToSpotMessages({ spotId: SPOT, limit: 5, onMessages: vi.fn() });
    f.onSnapshot.mock.calls[0][2](new Error("x"));
    expect(f.capture).toHaveBeenCalled();
  });
});

describe("reportSpotMessage", () => {
  const base = { messageId: "m1", spotId: SPOT, reportedBy: "u", reason: "spam" as const };

  it("validates ids and existence", async () => {
    await expect(reportSpotMessage({ ...base, spotId: "x" })).rejects.toThrow("Invalid spot ID");
    await expect(reportSpotMessage({ ...base, messageId: "" })).rejects.toThrow("Invalid message ID");
    f.getDoc.mockResolvedValue({ exists: () => false });
    await expect(reportSpotMessage(base)).rejects.toThrow("Message not found");
  });

  it("writes a pending report", async () => {
    f.getDoc.mockResolvedValue({ exists: () => true });
    await reportSpotMessage({ ...base, details: "  bad  " });
    expect(f.addDoc.mock.calls[0][1]).toMatchObject({ details: "bad", status: "pending" });
    await reportSpotMessage(base);
    expect(f.addDoc.mock.calls[1][1]).toMatchObject({ details: null });
  });

  it("rethrows a failed write", async () => {
    f.getDoc.mockResolvedValue({ exists: () => true });
    f.addDoc.mockRejectedValue(new Error("no"));
    await expect(reportSpotMessage(base)).rejects.toThrow("no");
    expect(f.capture).toHaveBeenCalled();
  });
});

describe("hide / unhide", () => {
  it.each([
    [hideSpotMessage, { isHidden: true, hiddenReason: "reported" }],
    [unhideSpotMessage, { isHidden: false, hiddenReason: null }],
  ] as const)("%# writes and rethrows", async (fn, data) => {
    await expect(fn("x", "m")).rejects.toThrow("Invalid spot ID");
    f.setDoc.mockResolvedValueOnce(undefined);
    await fn(SPOT, "m");
    expect(f.setDoc.mock.calls[0][1]).toEqual(data);
    f.setDoc.mockRejectedValueOnce(new Error("denied"));
    await expect(fn(SPOT, "m")).rejects.toThrow("denied");
  });
});

describe("fetchPendingMessageReports", () => {
  it("keeps well-formed reports", async () => {
    const d = new Date("2026-01-02T00:00:00Z");
    f.getDocs.mockResolvedValue({
      docs: [
        {
          id: "r1",
          data: () => ({
            messageId: "m",
            spotId: SPOT,
            reportedBy: "u",
            reason: "spam",
            status: "pending",
            details: "d",
            createdAt: ts(d),
          }),
        },
        {
          id: "r2",
          data: () => ({ messageId: "m", spotId: SPOT, reportedBy: "u", reason: "spam", status: "pending" }),
        },
        { id: "r3", data: () => ({ messageId: 1 }) },
      ],
    });
    const r = await fetchPendingMessageReports();
    expect(r.map((x) => x.id)).toEqual(["r1", "r2"]);
    expect(r[0]).toMatchObject({ details: "d", createdAt: d.toISOString() });
    expect(r[1].details).toBeUndefined();
  });

  it("returns [] on failure", async () => {
    f.getDocs.mockRejectedValue(new Error("x"));
    expect(await fetchPendingMessageReports()).toEqual([]);
    expect(f.capture).toHaveBeenCalled();
  });
});
