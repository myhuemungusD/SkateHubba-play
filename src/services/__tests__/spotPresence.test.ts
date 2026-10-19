import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as firebase from "../../firebase";

const kit = await vi.hoisted(() => import("./presence.test-helpers"));
const fns = vi.hoisted(() => kit.makeFunctionsMock());
const fs = vi.hoisted(() => ({ Timestamp: kit.FakeTimestamp, onSnapshot: vi.fn() }));

vi.mock("../../firebase");
vi.mock("firebase/functions", () => fns);
vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  query: vi.fn((ref: { path: string }, ...filters: unknown[]) => ({ path: ref.path, filters })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  onSnapshot: fs.onSnapshot,
  Timestamp: fs.Timestamp,
}));
const logFn = vi.hoisted(() => () => vi.fn());
vi.mock("../logger", () => ({ logger: { info: logFn(), warn: logFn(), debug: logFn(), error: logFn() } }));

const svc = await import("../spotPresence");
const { logger } = await import("../logger");

const SPOT = { id: "s1", name: "Plaza", latitude: 33.7, longitude: -117.8, day: "2026-10-18" };
const NOW = Date.UTC(2026, 9, 18, 20);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(firebase, "isEmulatorMode", { value: false, writable: true, configurable: true });
});
afterEach(() => vi.useRealTimers());

describe("settings and today's spot", () => {
  it("auto re-check-in defaults on and can be turned off", () => {
    expect(svc.getAutoRejoin()).toBe(true);
    svc.setAutoRejoin(false);
    expect(svc.getAutoRejoin()).toBe(false);
    svc.setAutoRejoin(true);
    expect(svc.getAutoRejoin()).toBe(true);
  });
  it("survives blocked storage", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(svc.getAutoRejoin()).toBe(true);
    expect(() => svc.setAutoRejoin(false)).not.toThrow();
    expect(svc.readActiveSpot(NOW)).toBeNull();
    expect(() => svc.rememberActiveSpot(SPOT, NOW)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
  it("remembers today's spot, fires an event, and forgets it tomorrow", () => {
    const heard = vi.fn();
    window.addEventListener(svc.ACTIVE_SPOT_EVENT, heard);
    svc.rememberActiveSpot(SPOT, NOW);
    expect(heard).toHaveBeenCalled();
    expect(svc.readActiveSpot(NOW)).toEqual(SPOT);
    expect(svc.readActiveSpot(NOW + 86_400_000)).toBeNull();
    localStorage.setItem(svc.ACTIVE_SPOT_KEY, JSON.stringify({ id: 1 }));
    expect(svc.readActiveSpot(NOW)).toBeNull();
    localStorage.setItem(svc.ACTIVE_SPOT_KEY, "null");
    expect(svc.readActiveSpot(NOW)).toBeNull();
    localStorage.removeItem(svc.ACTIVE_SPOT_KEY);
    expect(svc.readActiveSpot()).toBeNull();
    window.removeEventListener(svc.ACTIVE_SPOT_EVENT, heard);
  });
});

describe("rememberIfPassed", () => {
  const spot = { id: "s1", scope: "public", latitude: 1, longitude: 2 };
  it("follows the spot only after a passing public check-in", () => {
    expect(svc.rememberIfPassed(spot, { queued: true }, NOW)).toBe(false);
    expect(svc.rememberIfPassed(spot, { queued: false, result: { code: "too_far" } }, NOW)).toBe(false);
    expect(svc.rememberIfPassed({ ...spot, scope: "private" }, { queued: false, result: { code: "ok" } }, NOW)).toBe(
      false,
    );
    expect(svc.rememberIfPassed({ id: "s1" }, { queued: false, result: { code: "ok" } }, NOW)).toBe(false);
    expect(svc.rememberIfPassed({ id: "s1", latitude: 1 }, { queued: false, result: { code: "ok" } }, NOW)).toBe(false);
    expect(svc.rememberIfPassed(spot, { queued: false }, NOW)).toBe(false);
    for (const code of ["ok", "duplicate", "cooldown_spot"]) {
      expect(svc.rememberIfPassed(spot, { queued: false, result: { code } }, NOW)).toBe(true);
    }
    expect(svc.readActiveSpot(NOW)).toMatchObject({ id: "s1", name: "Spot" });
    expect(svc.rememberIfPassed({ ...spot, name: "Plaza" }, { queued: false, result: { code: "ok" } })).toBe(true);
  });
});

describe("sendPresence / leaveSpot", () => {
  it("calls mapPresence and normalizes the result", async () => {
    fns.callable.mockResolvedValueOnce({ data: { code: "here", expiresAt: 9 } });
    await expect(svc.sendPresence({ spotId: "s1" })).resolves.toEqual({ code: "here", expiresAt: 9 });
    expect(fns.httpsCallable).toHaveBeenCalledWith(expect.anything(), "mapPresence");
    fns.callable.mockResolvedValueOnce({ data: { code: "away" } });
    await expect(svc.leaveSpot("s1")).resolves.toEqual({ code: "away", expiresAt: null });
    expect(fns.callable).toHaveBeenLastCalledWith({ spotId: "s1", leave: true });
  });
  it("uses the emulator and rejects bad responses", async () => {
    Object.defineProperty(firebase, "isEmulatorMode", { value: true, writable: true, configurable: true });
    fns.callable.mockResolvedValueOnce({ data: null });
    await expect(svc.sendPresence({})).rejects.toThrow("bad response");
    expect(fns.connectFunctionsEmulator).toHaveBeenCalled();
  });
  it("needs an initialized app", async () => {
    const orig = firebase.default;
    Object.defineProperty(firebase, "default", { value: null, configurable: true, writable: true });
    await expect(svc.sendPresence({})).rejects.toThrow("Firebase not initialized");
    Object.defineProperty(firebase, "default", { value: orig, configurable: true, writable: true });
  });
});

describe("subscribeSkatersHere", () => {
  it("lists live skaters and drops lapsed ones", () => {
    vi.useFakeTimers();
    let t = NOW;
    let next: (snap: unknown) => void = () => {};
    const unsub = vi.fn();
    fs.onSnapshot.mockImplementation((_q, onNext) => {
      next = onNext;
      return unsub;
    });
    const seen = vi.fn();
    const stop = svc.subscribeSkatersHere("s1", seen, () => t);
    next({
      docs: [
        { id: "a", data: () => ({ username: "mike", expiresAt: fs.Timestamp.fromMillis(NOW + 60_000) }) },
        { id: "b", data: () => ({ expiresAt: "junk" }) },
        { id: "c", data: () => ({ username: "late", expiresAt: fs.Timestamp.fromMillis(NOW + 120_000) }) },
      ],
    });
    expect(seen).toHaveBeenLastCalledWith([
      { uid: "a", username: "mike" },
      { uid: "c", username: "late" },
    ]);
    t = NOW + 90_000;
    vi.advanceTimersByTime(30_000);
    expect(seen).toHaveBeenLastCalledWith([{ uid: "c", username: "late" }]);
    stop();
    expect(unsub).toHaveBeenCalled();
  });
  it("reports errors as an empty list", () => {
    fs.onSnapshot.mockImplementation((_q, _n, onErr) => {
      onErr({ code: "permission-denied" });
      onErr({});
      return vi.fn();
    });
    const seen = vi.fn();
    svc.subscribeSkatersHere("s1", seen)();
    expect(seen).toHaveBeenCalledWith([]);
    expect(logger.warn).toHaveBeenCalledWith("spot_presence_list_failed", { code: "permission-denied" });
  });
});

function fakeGeo() {
  let onFix: (p: GeolocationPosition) => void = () => {};
  let onErr: (e: GeolocationPositionError) => void = () => {};
  const geo = {
    watchPosition: vi.fn((ok, err) => {
      onFix = ok;
      onErr = err;
      return 7;
    }),
    clearWatch: vi.fn(),
    getCurrentPosition: vi.fn(),
  } as unknown as Geolocation;
  const at = (lat: number, lng = SPOT.longitude, accuracy = 10) =>
    onFix({ coords: { latitude: lat, longitude: lng, accuracy } } as GeolocationPosition);
  return { geo, at, fail: (code: number) => onErr({ code } as GeolocationPositionError) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const FAR = SPOT.latitude + 0.003;

describe("startSpotPresence", () => {
  it("reports denied without geolocation", () => {
    const status = vi.fn();
    svc.startSpotPresence(SPOT, status, { geo: null })();
    expect(status).toHaveBeenCalledWith("denied");
  });
  it("reports denied when the browser has no geolocation", () => {
    const status = vi.fn();
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });
    svc.startSpotPresence(SPOT, status);
    expect(status).toHaveBeenCalledWith("denied");
  });
  it("uses navigator.geolocation by default", () => {
    const status = vi.fn();
    const { geo } = fakeGeo();
    Object.defineProperty(navigator, "geolocation", { value: geo, configurable: true });
    const stop = svc.startSpotPresence(SPOT, status);
    expect(geo.watchPosition).toHaveBeenCalled();
    stop();
    stop();
    expect(geo.clearWatch).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenLastCalledWith("stopped");
  });
  it("beats on crossing, throttles inside, stays quiet away, and re-joins", async () => {
    let t = NOW;
    const send = vi.fn(async (_b: Record<string, unknown>): Promise<import("../spotPresence").PresenceResult> => ({
      code: "here",
      expiresAt: 1,
    }));
    const status = vi.fn();
    const { geo, at } = fakeGeo();
    svc.startSpotPresence(SPOT, status, { geo, send, now: () => t, autoRejoin: () => true });
    expect(status).toHaveBeenCalledWith("locating");
    at(SPOT.latitude, SPOT.longitude, -5);
    at(SPOT.latitude); // in flight: ignored
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ spotId: "s1", accuracyM: 0, mocked: false });
    t += 1000;
    at(SPOT.latitude);
    await flush();
    expect(send).toHaveBeenCalledTimes(1);
    t += svc.BEAT_MS;
    at(SPOT.latitude);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
    send.mockResolvedValueOnce({ code: "away", expiresAt: null });
    t += 1000;
    at(FAR);
    await flush();
    t += svc.BEAT_MS * 3;
    at(FAR);
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
    t += 1000;
    at(SPOT.latitude);
    await flush();
    expect(send).toHaveBeenCalledTimes(4);
    expect(status).toHaveBeenLastCalledWith("here");
  });
  it("stops after leaving when auto re-check-in is off", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ code: "here", expiresAt: 1 })
      .mockResolvedValueOnce({ code: "away", expiresAt: null });
    const { geo, at } = fakeGeo();
    svc.startSpotPresence(SPOT, vi.fn(), { geo, send, now: () => NOW, autoRejoin: () => false });
    at(SPOT.latitude);
    await flush();
    at(FAR);
    await flush();
    expect(geo.clearWatch).toHaveBeenCalledWith(7);
    at(SPOT.latitude);
    await flush();
    expect(send).toHaveBeenCalledTimes(2);
  });
  it("first fix away with auto off keeps watching", async () => {
    const send = vi.fn(async () => ({ code: "away" as const, expiresAt: null }));
    const { geo, at } = fakeGeo();
    svc.startSpotPresence(SPOT, vi.fn(), { geo, send, now: () => NOW, autoRejoin: () => false });
    at(FAR);
    await flush();
    expect(geo.clearWatch).not.toHaveBeenCalled();
  });
  it("stops without a day pass, retries after network errors, and handles permission errors", async () => {
    const send = vi
      .fn()
      .mockRejectedValueOnce(new Error("down"))
      .mockRejectedValueOnce("weird")
      .mockResolvedValueOnce({ code: "no_pass", expiresAt: null });
    const { geo, at, fail } = fakeGeo();
    const status = vi.fn();
    svc.startSpotPresence(SPOT, status, { geo, send, now: () => NOW });
    at(SPOT.latitude);
    await flush();
    at(SPOT.latitude);
    await flush();
    at(SPOT.latitude);
    await flush();
    expect(send).toHaveBeenCalledTimes(3);
    expect(geo.clearWatch).toHaveBeenCalled();
    fail(3);
    const g2 = fakeGeo();
    svc.startSpotPresence(SPOT, status, { geo: g2.geo, send });
    g2.fail(3);
    expect(g2.geo.clearWatch).not.toHaveBeenCalled();
    g2.fail(1);
    expect(status).toHaveBeenLastCalledWith("denied");
    expect(g2.geo.clearWatch).toHaveBeenCalled();
  });
});
