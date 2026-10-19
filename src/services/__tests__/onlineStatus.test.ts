import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kit = await vi.hoisted(() => import("./presence.test-helpers"));
const fs = vi.hoisted(() => ({
  Timestamp: kit.FakeTimestamp,
  onSnapshot: vi.fn(),
  setDoc: vi.fn(async () => undefined),
  updateDoc: vi.fn(async () => undefined),
}));
vi.mock("../../firebase");
vi.mock("firebase/firestore", () => ({
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  onSnapshot: fs.onSnapshot,
  setDoc: fs.setDoc,
  updateDoc: fs.updateDoc,
  serverTimestamp: vi.fn(() => "ts"),
  Timestamp: fs.Timestamp,
}));
const logFn = vi.hoisted(() => () => vi.fn());
vi.mock("../logger", () => ({ logger: { info: logFn(), warn: logFn(), debug: logFn(), error: logFn() } }));

const svc = await import("../onlineStatus");
const { logger } = await import("../logger");
const NOW = 1_000_000_000;

function setVisibility(v: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setVisibility("visible");
});
afterEach(() => vi.useRealTimers());

describe("classifyOnline", () => {
  it("buckets by age", () => {
    expect(svc.classifyOnline(null, NOW)).toBe("offline");
    expect(svc.classifyOnline(NOW - 1000, NOW)).toBe("online");
    expect(svc.classifyOnline(NOW - 10 * 60_000, NOW)).toBe("recent");
    expect(svc.classifyOnline(NOW - 60 * 60_000, NOW)).toBe("offline");
    expect(svc.classifyOnline(Date.now())).toBe("online");
  });
});

describe("hide + beat", () => {
  it("writes a server-clock beat, or a hidden marker with no time", async () => {
    await svc.beatOnline("u1");
    expect(fs.setDoc).toHaveBeenLastCalledWith({ path: "onlineStatus/u1" }, { lastSeen: "ts", hidden: false });
    await svc.setHideOnline("u1", true);
    expect(svc.getHideOnline()).toBe(true);
    expect(fs.setDoc).toHaveBeenLastCalledWith({ path: "onlineStatus/u1" }, { lastSeen: null, hidden: true });
    expect(fs.updateDoc).toHaveBeenLastCalledWith({ path: "skaterActivity/u1" }, { visible: false });
    await svc.setHideOnline("u1", false);
    expect(svc.getHideOnline()).toBe(false);
    expect(fs.updateDoc).toHaveBeenLastCalledWith({ path: "skaterActivity/u1" }, { visible: true });
  });
  it("survives blocked storage", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("x");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("x");
    });
    expect(svc.getHideOnline()).toBe(false);
    await svc.setHideOnline("u1", true);
    expect(fs.setDoc).toHaveBeenLastCalledWith({ path: "onlineStatus/u1" }, { lastSeen: null, hidden: true });
    get.mockRestore();
    set.mockRestore();
  });
});

describe("startOnlineHeartbeat", () => {
  it("beats now, on a timer, on return, and not while hidden", async () => {
    vi.useFakeTimers();
    const stop = svc.startOnlineHeartbeat("u1");
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(svc.ONLINE_BEAT_MS);
    expect(fs.setDoc).toHaveBeenCalledTimes(2);
    setVisibility("hidden");
    vi.advanceTimersByTime(svc.ONLINE_BEAT_MS);
    expect(fs.setDoc).toHaveBeenCalledTimes(2);
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(fs.setDoc).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(svc.ONLINE_BEAT_MS);
    expect(fs.setDoc).toHaveBeenCalledTimes(3);
  });
  it("logs failed beats", async () => {
    fs.setDoc.mockRejectedValueOnce(new Error("no")).mockRejectedValueOnce("odd");
    const stop = svc.startOnlineHeartbeat("u1");
    document.dispatchEvent(new Event("visibilitychange"));
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(logger.warn).toHaveBeenCalledWith("online_beat_failed", { error: "no" });
    expect(logger.warn).toHaveBeenCalledWith("online_beat_failed", { error: "unknown" });
  });
});

describe("subscribeOnline", () => {
  it("reads live, hidden, missing, and error states", () => {
    vi.useFakeTimers();
    let next: (s: unknown) => void = () => {};
    let err: () => void = () => {};
    fs.onSnapshot.mockImplementation((_r, n, e) => {
      next = n;
      err = e;
      return vi.fn();
    });
    let t = NOW;
    const seen = vi.fn();
    const stop = svc.subscribeOnline("u2", seen, () => t);
    next({ exists: () => true, data: () => ({ lastSeen: fs.Timestamp.fromMillis(NOW), hidden: false }) });
    expect(seen).toHaveBeenLastCalledWith("online");
    t = NOW + 10 * 60_000;
    vi.advanceTimersByTime(60_000);
    expect(seen).toHaveBeenLastCalledWith("recent");
    next({ exists: () => true, data: () => ({ lastSeen: fs.Timestamp.fromMillis(t), hidden: true }) });
    expect(seen).toHaveBeenLastCalledWith("offline");
    next({ exists: () => true, data: () => ({ lastSeen: "x", hidden: false }) });
    expect(seen).toHaveBeenLastCalledWith("offline");
    next({ exists: () => false });
    expect(seen).toHaveBeenLastCalledWith("offline");
    err();
    expect(seen).toHaveBeenLastCalledWith("offline");
    stop();
    svc.subscribeOnline("u2", seen)();
  });
});
