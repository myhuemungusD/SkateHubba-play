import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as firebase from "../../firebase";
import { captureException } from "../../lib/sentry";
import { logger } from "../logger";

const fns = vi.hoisted(() => {
  const callable = vi.fn();
  return {
    callable,
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => callable),
    connectFunctionsEmulator: vi.fn(),
  };
});
const fs = vi.hoisted(() => ({
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  setDoc: vi.fn(async () => undefined),
  batchSet: vi.fn(),
  commit: vi.fn(async () => undefined),
}));

vi.mock("../../firebase");
vi.mock("../../lib/sentry", () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("firebase/functions", () => ({
  getFunctions: fns.getFunctions,
  httpsCallable: fns.httpsCallable,
  connectFunctionsEmulator: fns.connectFunctionsEmulator,
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  doc: vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join("/") })),
  query: vi.fn((ref: { path: string }, ...filters: unknown[]) => ({ path: ref.path, filters })),
  where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
  getDocs: fs.getDocs,
  getDoc: fs.getDoc,
  setDoc: fs.setDoc,
  serverTimestamp: vi.fn(() => "ts"),
  writeBatch: vi.fn(() => ({ set: fs.batchSet, commit: fs.commit })),
}));

const svc = await import("../mapCheckins");

const OK = { code: "ok", xp: 55, newSpot: true, pioneer: true, badgeId: null, rewardsPaused: false };
const fix = async () => ({ lat: 1, lng: 2, accuracyM: 8 });
const netErr = Object.assign(new Error("down"), { code: "functions/unavailable" });
const finalErr = Object.assign(new Error("no"), { code: "functions/failed-precondition" });

function setOnline(v: boolean) {
  Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setOnline(true);
  Object.defineProperty(firebase, "isEmulatorMode", { value: false, writable: true, configurable: true });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("getCurrentFix", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "geolocation", original);
    else delete (navigator as { geolocation?: unknown }).geolocation;
  });
  function setGeo(impl: (ok: PositionCallback, bad: PositionErrorCallback) => void) {
    Object.defineProperty(navigator, "geolocation", {
      value: { getCurrentPosition: impl },
      configurable: true,
    });
  }

  it("resolves one fix", async () => {
    setGeo((ok) => ok({ coords: { latitude: 3, longitude: 4, accuracy: 9 } } as GeolocationPosition));
    await expect(svc.getCurrentFix()).resolves.toEqual({ lat: 3, lng: 4, accuracyM: 9 });
  });
  it("explains a denied permission and other failures", async () => {
    setGeo((_ok, bad) => bad({ code: 1 } as GeolocationPositionError));
    await expect(svc.getCurrentFix()).rejects.toThrow(/Allow location/);
    setGeo((_ok, bad) => bad({ code: 3 } as GeolocationPositionError));
    await expect(svc.getCurrentFix()).rejects.toThrow(/Couldn't get/);
  });
  it("fails cleanly without geolocation", async () => {
    delete (navigator as { geolocation?: unknown }).geolocation;
    await expect(svc.getCurrentFix()).rejects.toBeInstanceOf(svc.LocationError);
  });
});

describe("checkInAtSpot", () => {
  it("sends the fix and returns the server result", async () => {
    fns.callable.mockResolvedValueOnce({ data: OK });
    const out = await svc.checkInAtSpot({ id: "s1" }, fix);
    expect(out).toEqual({ queued: false, result: OK });
    const payload = fns.callable.mock.calls[0]?.[0];
    expect(payload).toMatchObject({ spotId: "s1", scope: "public", lat: 1, lng: 2, accuracyM: 8, mocked: false });
    expect(typeof payload.clientId).toBe("string");
    expect(fns.httpsCallable).toHaveBeenCalledWith(expect.anything(), "mapCheckin");
  });

  it("uses the emulator and the private scope when asked, and clamps accuracy", async () => {
    Object.defineProperty(firebase, "isEmulatorMode", { value: true, writable: true, configurable: true });
    fns.callable.mockResolvedValueOnce({ data: OK });
    await svc.checkInAtSpot({ id: "p1", scope: "private" }, async () => ({ lat: 0, lng: 0, accuracyM: -3 }));
    expect(fns.connectFunctionsEmulator).toHaveBeenCalled();
    expect(fns.callable.mock.calls[0]?.[0]).toMatchObject({ scope: "private", accuracyM: 0 });
  });

  it("queues on a network error", async () => {
    fns.callable.mockRejectedValueOnce(netErr);
    expect(await svc.checkInAtSpot({ id: "s1" }, fix)).toEqual({ queued: true });
    expect(svc.readQueue()).toHaveLength(1);
  });

  it("queues when the browser is offline even with an odd error", async () => {
    setOnline(false);
    fns.callable.mockRejectedValueOnce("weird");
    expect(await svc.checkInAtSpot({ id: "s1" }, fix)).toEqual({ queued: true });
  });

  it("throws final errors and reports them", async () => {
    fns.callable.mockRejectedValueOnce(finalErr);
    await expect(svc.checkInAtSpot({ id: "s1" }, fix)).rejects.toBe(finalErr);
    expect(captureException).toHaveBeenCalledWith(finalErr);
  });

  it("rejects a malformed response and a missing app", async () => {
    fns.callable.mockResolvedValueOnce({ data: { nope: 1 } });
    await expect(svc.checkInAtSpot({ id: "s1" }, fix)).rejects.toThrow("bad response");
    fns.callable.mockResolvedValueOnce({ data: null });
    await expect(svc.checkInAtSpot({ id: "s1" }, fix)).rejects.toThrow("bad response");
    const previous = Object.getOwnPropertyDescriptor(firebase, "default");
    Object.defineProperty(firebase, "default", { configurable: true, get: () => null });
    await expect(svc.checkInAtSpot({ id: "s1" }, fix)).rejects.toThrow("Firebase not initialized");
    if (previous) Object.defineProperty(firebase, "default", previous);
  });

  it("falls back to a home-made client id without crypto.randomUUID", async () => {
    const spy = vi.spyOn(crypto, "randomUUID").mockImplementation(undefined as never);
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    fns.callable.mockResolvedValueOnce({ data: OK });
    await svc.checkInAtSpot({ id: "s1" }, fix);
    expect(fns.callable.mock.calls[0]?.[0].clientId).toMatch(/^c/);
    spy.mockRestore();
  });
});

describe("offline queue", () => {
  function queued(over: Record<string, unknown> = {}) {
    return {
      spotId: "s1",
      scope: "public",
      lat: 1,
      lng: 2,
      accuracyM: 5,
      clientAt: Date.now(),
      clientId: "q1",
      mocked: false,
      ...over,
    };
  }

  it("reads only valid entries and survives garbage", () => {
    localStorage.setItem(svc.QUEUE_KEY, "{not json");
    expect(svc.readQueue()).toEqual([]);
    localStorage.setItem(svc.QUEUE_KEY, JSON.stringify({ a: 1 }));
    expect(svc.readQueue()).toEqual([]);
    localStorage.setItem(svc.QUEUE_KEY, JSON.stringify([queued(), { spotId: 1 }, null]));
    expect(svc.readQueue()).toHaveLength(1);
  });

  it("sends, keeps retryable, drops final and expired items", async () => {
    const now = Date.now();
    localStorage.setItem(
      svc.QUEUE_KEY,
      JSON.stringify([
        queued({ clientId: "sent" }),
        queued({ clientId: "retry" }),
        queued({ clientId: "final" }),
        queued({ clientId: "old", clientAt: now - svc.QUEUE_MAX_AGE_MS - 1 }),
      ]),
    );
    fns.callable.mockResolvedValueOnce({ data: OK }).mockRejectedValueOnce(netErr).mockRejectedValueOnce(finalErr);
    const results = await svc.flushCheckinQueue(now);
    expect(results).toEqual([OK]);
    expect(svc.readQueue().map((p) => p.clientId)).toEqual(["retry"]);
    expect(logger.warn).toHaveBeenCalledWith("checkin_queue_dropped", { code: "functions/failed-precondition" });
  });

  it("clears storage when everything sent, and shares one flush at a time", async () => {
    localStorage.setItem(svc.QUEUE_KEY, JSON.stringify([queued()]));
    fns.callable.mockResolvedValueOnce({ data: OK });
    const a = svc.flushCheckinQueue();
    const b = svc.flushCheckinQueue();
    expect(a).toBe(b);
    await a;
    expect(localStorage.getItem(svc.QUEUE_KEY)).toBeNull();
  });

  it("replaces a queued item with the same clientId", async () => {
    fns.callable.mockRejectedValue(netErr);
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("1-1-1-1-1");
    await svc.checkInAtSpot({ id: "s1" }, fix);
    await svc.checkInAtSpot({ id: "s1" }, fix);
    expect(svc.readQueue()).toHaveLength(1);
    uuid.mockRestore();
    fns.callable.mockReset();
  });

  it("ignores storage write failures", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    fns.callable.mockRejectedValueOnce(netErr);
    await expect(svc.checkInAtSpot({ id: "s1" }, fix)).resolves.toEqual({ queued: true });
    setItem.mockRestore();
  });

  it("starts flushing now and on reconnect, and stops", async () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const stop = svc.startCheckinQueue();
    const handler = add.mock.calls.find((c) => c[0] === "online")?.[1] as () => void;
    handler();
    stop();
    expect(remove).toHaveBeenCalledWith("online", handler);
    add.mockRestore();
    remove.mockRestore();
  });
});

describe("isRetryable", () => {
  it("knows network codes", () => {
    expect(svc.isRetryable(netErr)).toBe(true);
    expect(svc.isRetryable(finalErr)).toBe(false);
    expect(svc.isRetryable(null)).toBe(false);
  });
});

describe("describeCheckin", () => {
  const r = (over: Record<string, unknown>) => ({ queued: false as const, result: { ...OK, ...over } as never });
  it.each([
    [{ queued: true as const }, /No signal/],
    [r({}), /Checked in! \+55 XP \(pioneer bonus\)\./],
    [r({ code: "duplicate", xp: 5, pioneer: false }), /^Checked in! \+5 XP\.$/],
    [r({ xp: 0, badgeId: "legend_x" }), /^Checked in! Legendary badge earned\.$/],
    [r({ rewardsPaused: true }), /paused/],
    [r({ code: "cooldown_spot" }), /already checked in/],
    [r({ code: "cooldown_hour" }), /a lot of check-ins/],
    [r({ code: "too_far" }), /100 m/],
    [r({ code: "low_accuracy" }), /GPS/],
    [r({ code: "stale" }), /too old/],
    [r({ code: "suspect" }), /didn't look right/],
    [r({ code: "not_allowed" }), /can't check in/],
  ])("%#", (outcome, text) => {
    expect(svc.describeCheckin(outcome)).toMatch(text);
  });
});

describe("passport", () => {
  const d = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });

  it("lists every stamp for the owner, newest first, with defaults", async () => {
    fs.getDocs.mockResolvedValueOnce({
      docs: [
        d("a", {
          spotId: "a",
          scope: "public",
          spotName: "A",
          legendary: true,
          count: 2,
          firstAt: { toDate: () => new Date(1) },
        }),
        d("p_b", { scope: "private", firstAt: { toDate: () => new Date(5) } }),
        d("c", {}),
      ],
    });
    const list = await svc.listPassport("u1", true);
    expect(list.map((s) => s.id)).toEqual(["p_b", "a", "c"]);
    expect(list[0]).toMatchObject({ spotId: "p_b", scope: "private", spotName: "Spot", count: 1, legendary: false });
    expect(list[2]?.firstAt).toBeNull();
    expect(fs.getDocs.mock.calls[0]?.[0]).toEqual({ path: "users/u1/passport" });
  });

  it("sorts undated stamps last from either side", async () => {
    const dated = d("x", { firstAt: { toDate: () => new Date(9) } });
    fs.getDocs.mockResolvedValueOnce({ docs: [d("n", {}), dated] });
    expect((await svc.listPassport("u1", true)).map((s) => s.id)).toEqual(["x", "n"]);
    fs.getDocs.mockResolvedValueOnce({ docs: [dated, d("n", {})] });
    expect((await svc.listPassport("u1", true)).map((s) => s.id)).toEqual(["x", "n"]);
  });

  it("filters to public stamps for visitors", async () => {
    fs.getDocs.mockResolvedValueOnce({ docs: [] });
    await svc.listPassport("u1", false);
    expect(fs.getDocs.mock.calls[0]?.[0]).toMatchObject({ filters: [{ field: "scope", op: "==", value: "public" }] });
  });

  it("reads and writes the public setting", async () => {
    fs.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ public: true }) });
    expect(await svc.getPassportPublic("u1")).toBe(true);
    fs.getDoc.mockResolvedValueOnce({ exists: () => false, data: () => ({}) });
    expect(await svc.getPassportPublic("u1")).toBe(false);
    await svc.setPassportPublic("u1", true);
    expect(fs.setDoc).toHaveBeenCalledWith({ path: "passportSettings/u1" }, { public: true });
  });
});

describe("private spots", () => {
  const req = {
    name: "Secret",
    latitude: 1,
    longitude: 2,
    gnarRating: 3 as const,
    bustRisk: 2 as const,
    obstacles: [],
    photoUrls: [],
  };

  it("resolves crew usernames and reports unknown ones", async () => {
    fs.getDoc
      .mockResolvedValueOnce({ exists: () => true, data: () => ({ uid: "u2" }) })
      .mockResolvedValueOnce({ exists: () => false, data: () => ({}) })
      .mockResolvedValueOnce({ exists: () => true, data: () => ({}) });
    const out = await svc.resolveCrew(["@Mike", " ghost ", "", "mike", "odd"]);
    expect(out).toEqual({ uids: ["u2"], unknown: ["ghost", "odd"] });
  });

  it("creates a crew spot with the cooldown anchor", async () => {
    const spot = await svc.createPrivateSpot({ ...req, description: "shh" }, "u1", "crew", ["u2"]);
    expect(fs.batchSet).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/^privateSpots\//) }),
      expect.objectContaining({ visibility: "crew", crewUids: ["u2"], description: "shh", isActive: true }),
    );
    expect(fs.batchSet).toHaveBeenCalledWith({ path: "users/u1" }, { lastSpotCreatedAt: "ts" }, { merge: true });
    expect(spot).toMatchObject({ scope: "private", visibility: "crew", name: "Secret" });
  });

  it("drops crew for an only-me spot, and works without randomUUID", async () => {
    Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
    const spot = await svc.createPrivateSpot(req, "u1", "private", ["u2"]);
    expect(spot).toMatchObject({ crewUids: [], description: null });
  });

  it("lists own and crew spots once each, skipping malformed docs", async () => {
    const doc = (id: string, data: Record<string, unknown>) => ({ id, data: () => data });
    const base = { name: "S", latitude: 1, longitude: 2 };
    fs.getDocs
      .mockResolvedValueOnce({
        docs: [
          doc("a", {
            ...base,
            visibility: "private",
            createdBy: "u1",
            gnarRating: 4,
            bustRisk: 2,
            obstacles: ["ledge"],
            photoUrls: ["x"],
            description: "d",
          }),
        ],
      })
      .mockResolvedValueOnce({
        docs: [
          doc("a", { ...base, visibility: "crew" }),
          doc("b", { ...base, visibility: "crew" }),
          doc("bad", { name: 1 }),
        ],
      });
    const list = await svc.listMyPrivateSpots("u1");
    expect(list.map((s) => s.id)).toEqual(["a", "b"]);
    expect(list[1]).toMatchObject({
      createdBy: "",
      gnarRating: 1,
      bustRisk: 1,
      obstacles: [],
      photoUrls: [],
      visibility: "crew",
    });
  });

  it("returns nothing when the query fails", async () => {
    fs.getDocs.mockRejectedValueOnce(Object.assign(new Error("x"), { code: "permission-denied" }));
    expect(await svc.listMyPrivateSpots("u1")).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith("private_spots_load_failed", { error: "permission-denied" });
  });
});
