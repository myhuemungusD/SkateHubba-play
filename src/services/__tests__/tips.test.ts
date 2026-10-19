import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSetDoc, mockGetDoc, mockDoc } = vi.hoisted(() => ({
  mockSetDoc: vi.fn().mockResolvedValue(undefined),
  mockGetDoc: vi.fn(),
  mockDoc: vi.fn((...args: unknown[]) => ({ __path: args.slice(1).join("/") })),
}));
vi.mock("firebase/firestore", () => ({
  doc: mockDoc,
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
  arrayUnion: (...v: unknown[]) => ({ __union: v }),
}));
vi.mock("../../firebase");
vi.mock("../../lib/sentry", () => {
  const noop = () => undefined;
  return { captureException: noop, captureMessage: noop, addBreadcrumb: noop, setUser: noop, initSentry: noop };
});

import { getLocalTips, setLocalTips, loadTips, markTipSeen, setTipsDisabled, resetTips, MAX_TIPS_SEEN } from "../tips";

const UID = "u1";
const KEY = `skatehubba.tips.v1.${UID}`;
const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data });

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockSetDoc.mockResolvedValue(undefined);
});

describe("local tips state", () => {
  it("is empty without a uid, a stored value, or valid JSON", () => {
    expect(getLocalTips("")).toEqual({ seen: [], disabled: false });
    expect(getLocalTips(UID)).toEqual({ seen: [], disabled: false });
    localStorage.setItem(KEY, "null");
    expect(getLocalTips(UID)).toEqual({ seen: [], disabled: false });
    localStorage.setItem(KEY, "{bad");
    expect(getLocalTips(UID)).toEqual({ seen: [], disabled: false });
  });
  it("round-trips and drops junk ids", () => {
    setLocalTips(UID, { seen: ["map", 3 as unknown as string], disabled: true });
    expect(getLocalTips(UID)).toEqual({ seen: ["map"], disabled: true });
    localStorage.setItem(KEY, JSON.stringify({ seen: "x" }));
    expect(getLocalTips(UID)).toEqual({ seen: [], disabled: false });
  });
  it("ignores a missing uid and storage failures", () => {
    setLocalTips("", { seen: ["a"], disabled: false });
    expect(localStorage.length).toBe(0);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => setLocalTips(UID, { seen: [], disabled: false })).not.toThrow();
    spy.mockRestore();
  });
});

describe("loadTips", () => {
  it("returns local without a uid", async () => {
    expect(await loadTips("")).toEqual({ seen: [], disabled: false });
    expect(mockGetDoc).not.toHaveBeenCalled();
  });
  it("returns local when the doc is missing or the read fails", async () => {
    setLocalTips(UID, { seen: ["a"], disabled: false });
    mockGetDoc.mockResolvedValueOnce(snap(null));
    expect(await loadTips(UID)).toEqual({ seen: ["a"], disabled: false });
    mockGetDoc.mockRejectedValueOnce(new Error("offline"));
    expect(await loadTips(UID)).toEqual({ seen: ["a"], disabled: false });
  });
  it("unions seen ids and lets the server's switch win", async () => {
    setLocalTips(UID, { seen: ["a"], disabled: false });
    mockGetDoc.mockResolvedValueOnce(snap({ tipsSeen: ["b", "a"], tipsDisabled: true }));
    expect(await loadTips(UID)).toEqual({ seen: ["a", "b"], disabled: true });
    expect(getLocalTips(UID)).toEqual({ seen: ["a", "b"], disabled: true });
    mockGetDoc.mockResolvedValueOnce(snap({}));
    expect((await loadTips(UID)).disabled).toBe(true);
  });
});

describe("writes", () => {
  it("marks a set seen once and writes arrayUnion", async () => {
    expect(await markTipSeen(UID, "map")).toEqual({ seen: ["map"], disabled: false });
    expect(mockSetDoc).toHaveBeenCalledWith(expect.anything(), { tipsSeen: { __union: ["map"] } }, { merge: true });
    await markTipSeen(UID, "map");
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });
  it("skips empty input and does not write past the cap", async () => {
    await markTipSeen("", "map");
    await markTipSeen(UID, "");
    setLocalTips(UID, { seen: Array.from({ length: MAX_TIPS_SEEN }, (_, i) => `t${i}`), disabled: false });
    await markTipSeen(UID, "extra");
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
  it("swallows write failures", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("denied"));
    await expect(setTipsDisabled(UID, true)).resolves.toEqual({ seen: [], disabled: true });
    expect(getLocalTips(UID).disabled).toBe(true);
  });
  it("toggles and resets, no-op without a uid", async () => {
    expect(await setTipsDisabled("", true)).toEqual({ seen: [], disabled: true });
    expect(await resetTips("")).toEqual({ seen: [], disabled: false });
    expect(mockSetDoc).not.toHaveBeenCalled();
    setLocalTips(UID, { seen: ["a"], disabled: true });
    expect(await resetTips(UID)).toEqual({ seen: [], disabled: false });
    expect(mockSetDoc).toHaveBeenCalledWith(expect.anything(), { tipsSeen: [], tipsDisabled: false }, { merge: true });
  });
});
