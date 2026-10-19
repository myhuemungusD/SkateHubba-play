import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const kit = await vi.hoisted(() => import("./presence.test-helpers"));
const fs = vi.hoisted(() => ({
  Timestamp: kit.FakeTimestamp,
  onSnapshot: vi.fn(),
  updateDoc: vi.fn(),
}));
vi.mock("../../firebase");
vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  query: vi.fn((ref: { path: string }, ...parts: unknown[]) => ({ path: ref.path, parts })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  orderBy: vi.fn((field: string, dir: string) => ({ orderBy: field, dir })),
  limit: vi.fn((n: number) => ({ limit: n })),
  onSnapshot: fs.onSnapshot,
  updateDoc: fs.updateDoc,
  Timestamp: fs.Timestamp,
}));
const logFn = vi.hoisted(() => () => vi.fn());
vi.mock("../logger", () => ({ logger: { info: logFn(), warn: logFn(), debug: logFn(), error: logFn() } }));

const svc = await import("../whosSkating");
const { logger } = await import("../logger");

const NOW = Date.UTC(2026, 9, 19, 20);
const MIN = 60_000;
const row = (uid: string, lastAgoMin: number, hereForMin: number, over: Partial<Record<string, unknown>> = {}) => ({
  uid,
  username: uid,
  spotId: "s1",
  spotName: "Cherry Park",
  lastAt: NOW - lastAgoMin * MIN,
  hereUntil: NOW + hereForMin * MIN,
  ...over,
});

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.useRealTimers());

describe("splitActivity", () => {
  it("puts live skaters in now, the rest of the day in recent, newest first", () => {
    const out = svc.splitActivity(
      [row("old", 25 * 60, -1), row("recent", 120, -100), row("now", 1, 9), row("now2", 0, 5), row("me", 0, 9)],
      "me",
      NOW,
    );
    expect(out.now.map((r) => r.uid)).toEqual(["now2", "now"]);
    expect(out.recent.map((r) => r.uid)).toEqual(["recent"]);
  });
  it("drops rows without a username or spot", () => {
    const out = svc.splitActivity([row("a", 1, 5, { username: "" }), row("b", 1, 5, { spotId: "" })], null, NOW);
    expect(out).toEqual({ now: [], recent: [] });
  });
});

describe("agoLabel", () => {
  it.each([
    [NOW + 5000, "just now"],
    [NOW - 30_000, "just now"],
    [NOW - 5 * MIN, "5m ago"],
    [NOW - 2 * 60 * MIN, "2h ago"],
    [NOW - 49 * 60 * MIN, "2d ago"],
  ])("%s → %s", (then, label) => {
    expect(svc.agoLabel(then, NOW)).toBe(label);
  });
});

describe("subscribeWhosSkating", () => {
  type Snap = { docs: { id: string; data: () => Record<string, unknown> }[] };
  let next: (s: Snap) => void = () => undefined;
  let fail: (e: unknown) => void = () => undefined;
  const unsub = vi.fn();
  beforeEach(() => {
    fs.onSnapshot.mockImplementation((_q: unknown, n: typeof next, f: typeof fail) => {
      next = n;
      fail = f;
      return unsub;
    });
  });

  it("asks only for visible skaters in the last day, capped", () => {
    svc.subscribeWhosSkating("me", vi.fn(), () => NOW)();
    const q = fs.onSnapshot.mock.calls[0]![0] as { path: string; parts: Record<string, unknown>[] };
    expect(q.path).toBe("skaterActivity");
    expect(q.parts[0]).toEqual({ field: "visible", op: "==", value: true });
    expect(q.parts[1]).toMatchObject({ field: "lastAt", op: ">" });
    expect((q.parts[1]!.value as InstanceType<typeof kit.FakeTimestamp>).toMillis()).toBe(NOW - svc.ACTIVITY_WINDOW_MS);
    expect(q.parts[3]).toEqual({ limit: svc.WHOS_SKATING_LIMIT });
    expect(unsub).toHaveBeenCalled();
  });

  it("maps docs, moves lapsed skaters to recent on the timer, and stops cleanly", () => {
    vi.useFakeTimers();
    let t = NOW;
    const seen = vi.fn();
    const stop = svc.subscribeWhosSkating(null, seen, () => t);
    next({
      docs: [
        {
          id: "a",
          data: () => ({
            username: "alex",
            spotId: "s1",
            spotName: "Cherry Park",
            lastAt: kit.FakeTimestamp.fromMillis(NOW - MIN),
            hereUntil: kit.FakeTimestamp.fromMillis(NOW + MIN),
          }),
        },
        { id: "b", data: () => ({ username: 7, spotId: "s2", lastAt: "x" }) },
        { id: "c", data: () => ({ username: "cam", spotId: "s3", lastAt: kit.FakeTimestamp.fromMillis(NOW - MIN) }) },
      ],
    });
    expect(seen).toHaveBeenLastCalledWith({
      now: [
        { uid: "a", username: "alex", spotId: "s1", spotName: "Cherry Park", lastAt: NOW - MIN, hereUntil: NOW + MIN },
      ],
      recent: [{ uid: "c", username: "cam", spotId: "s3", spotName: "a spot", lastAt: NOW - MIN, hereUntil: 0 }],
    });
    t = NOW + 2 * MIN;
    vi.advanceTimersByTime(30_000);
    expect(seen.mock.lastCall![0].now).toEqual([]);
    expect(seen.mock.lastCall![0].recent.map((r: { uid: string }) => r.uid)).toEqual(["a", "c"]);
    stop();
    const calls = seen.mock.calls.length;
    vi.advanceTimersByTime(60_000);
    expect(seen.mock.calls.length).toBe(calls);
  });

  it("empties the list and logs when the read fails", () => {
    const seen = vi.fn();
    svc.subscribeWhosSkating("me", seen, () => NOW);
    fail({ code: "permission-denied" });
    fail(new Error("x"));
    expect(seen).toHaveBeenLastCalledWith({ now: [], recent: [] });
    expect(logger.warn).toHaveBeenCalledWith("whos_skating_list_failed", { code: "permission-denied" });
    expect(logger.warn).toHaveBeenCalledWith("whos_skating_list_failed", { code: "unknown" });
  });

  it("uses the real clock by default", () => {
    svc.subscribeWhosSkating("me", vi.fn())();
    expect(fs.onSnapshot).toHaveBeenCalled();
  });
});

describe("setActivityVisible", () => {
  it("writes only visible, ignores a missing doc, logs other failures", async () => {
    fs.updateDoc.mockResolvedValueOnce(undefined);
    await svc.setActivityVisible("u1", false);
    expect(fs.updateDoc).toHaveBeenCalledWith({ path: "skaterActivity/u1" }, { visible: false });
    fs.updateDoc.mockRejectedValueOnce({ code: "not-found" });
    await svc.setActivityVisible("u1", true);
    expect(logger.warn).not.toHaveBeenCalled();
    fs.updateDoc.mockRejectedValueOnce({ code: "permission-denied" });
    await svc.setActivityVisible("u1", true);
    fs.updateDoc.mockRejectedValueOnce(new Error("x"));
    await svc.setActivityVisible("u1", true);
    expect(logger.warn).toHaveBeenCalledWith("whos_skating_visible_failed", { code: "permission-denied" });
    expect(logger.warn).toHaveBeenCalledWith("whos_skating_visible_failed", { code: "unknown" });
  });
});
