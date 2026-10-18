import { describe, expect, it, vi } from "vitest";
import type { DiceDb, DiceDoc, DiceTx } from "../dice/store.js";
import {
  CheckinInputError,
  distanceM,
  MAX_QUEUE_AGE_MS,
  NEW_SPOT_XP,
  parseCheckinRequest,
  passportId,
  pauseMs,
  PAUSE_MAX_MS,
  performCheckin,
  PIONEER_IDLE_MS,
  PIONEER_XP,
  REPEAT_XP,
  spotPath,
  type CheckinRequest,
} from "./checkin.js";

vi.mock("firebase-functions/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const NOW = Date.UTC(2026, 9, 17, 20, 0, 0);
const LAT = 33.7;
const LNG = -117.8;

class MemoryDb implements DiceDb {
  docs = new Map<string, Record<string, unknown>>();
  seed(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, { ...data });
  }
  async get(path: string): Promise<DiceDoc> {
    const data = this.docs.get(path);
    return { id: path.split("/").pop() ?? path, data: data ? { ...data } : undefined };
  }
  async query(): Promise<DiceDoc[]> {
    return [];
  }
  async add(): Promise<void> {}
  newId(): string {
    return "id";
  }
  async runTransaction<T>(fn: (tx: DiceTx) => Promise<T>): Promise<T> {
    let wrote = false;
    const tx: DiceTx = {
      get: (path) => {
        if (wrote) throw new Error("read after write");
        return this.get(path);
      },
      query: () => Promise.resolve([]),
      set: (path, data, merge) => {
        wrote = true;
        this.docs.set(path, { ...(merge ? this.docs.get(path) : undefined), ...data });
      },
      update: (path, data) => {
        wrote = true;
        const prev = this.docs.get(path);
        if (!prev) throw new Error(`missing ${path}`);
        this.docs.set(path, { ...prev, ...data });
      },
    };
    return fn(tx);
  }
}

function req(over: Partial<CheckinRequest> = {}): CheckinRequest {
  return {
    spotId: "s1",
    scope: "public",
    lat: LAT,
    lng: LNG,
    accuracyM: 10,
    clientAt: NOW,
    clientId: "c1",
    mocked: false,
    ...over,
  };
}

function setup(spot: Record<string, unknown> = {}, user: Record<string, unknown> | null = { xp: 0 }): MemoryDb {
  const db = new MemoryDb();
  db.seed("spots/s1", { name: "El Toro", latitude: LAT, longitude: LNG, isActive: true, createdBy: "other", ...spot });
  if (user) db.seed("users/u1", user);
  return db;
}

const actor = { uid: "u1", nowMs: NOW, xpOn: true };

describe("parseCheckinRequest", () => {
  const good = { spotId: "s1", lat: 1, lng: 2, accuracyM: 5, clientAt: NOW, clientId: "c1" };
  it("accepts a valid body and defaults scope and mocked", () => {
    expect(parseCheckinRequest(good)).toEqual({ ...good, scope: "public", mocked: false });
    expect(parseCheckinRequest({ ...good, scope: "private", mocked: true }).mocked).toBe(true);
  });
  it.each([
    [null, "bad_request"],
    ["x", "bad_request"],
    [{ ...good, spotId: "a/b" }, "bad_spot"],
    [{ ...good, spotId: 3 }, "bad_spot"],
    [{ ...good, scope: "crew" }, "bad_scope"],
    [{ ...good, lat: 91 }, "bad_lat"],
    [{ ...good, lat: -91 }, "bad_lat"],
    [{ ...good, lat: "1" }, "bad_lat"],
    [{ ...good, lng: 181 }, "bad_lng"],
    [{ ...good, lng: -181 }, "bad_lng"],
    [{ ...good, accuracyM: -1 }, "bad_accuracy"],
    [{ ...good, accuracyM: Number.NaN }, "bad_accuracy"],
    [{ ...good, clientAt: "now" }, "bad_time"],
    [{ ...good, clientId: "" }, "bad_client_id"],
  ])("rejects %j", (body, message) => {
    expect(() => parseCheckinRequest(body)).toThrow(new CheckinInputError(message));
  });
});

describe("helpers", () => {
  it("measures distance", () => {
    expect(distanceM(0, 0, 0, 0)).toBe(0);
    expect(Math.round(distanceM(0, 0, 0.001, 0))).toBe(111);
  });
  it("names paths for both scopes", () => {
    expect(spotPath({ scope: "public", spotId: "a" })).toBe("spots/a");
    expect(spotPath({ scope: "private", spotId: "a" })).toBe("privateSpots/a");
    expect(passportId({ scope: "public", spotId: "a" })).toBe("a");
    expect(passportId({ scope: "private", spotId: "a" })).toBe("p_a");
  });
  it("grows the pause and caps it", () => {
    expect(pauseMs(2)).toBe(0);
    expect(pauseMs(3)).toBe(7 * 86_400_000);
    expect(pauseMs(4)).toBe(14 * 86_400_000);
    expect(pauseMs(20)).toBe(PAUSE_MAX_MS);
  });
});

describe("performCheckin", () => {
  it("pays new-spot XP plus the pioneer bonus and stamps the passport", async () => {
    const db = setup();
    const out = await performCheckin(db, actor, req());
    expect(out).toEqual({
      code: "ok",
      xp: NEW_SPOT_XP + PIONEER_XP,
      newSpot: true,
      pioneer: true,
      badgeId: null,
      rewardsPaused: false,
    });
    expect(db.docs.get("users/u1")).toMatchObject({ xp: 100, level: 3, xpToday: 100 });
    expect(db.docs.get("users/u1/passport/s1")).toMatchObject({ count: 1, spotName: "El Toro", legendary: false });
    expect(db.docs.get("users/u1/xpMarkers/spot_s1")).toMatchObject({ kind: "spot" });
    expect(db.docs.get("spots/s1")).toMatchObject({ checkinCount: 1 });
    expect(db.docs.get("users/u1/checkins/c1")).toMatchObject({ verdict: "ok", xp: 100 });
  });

  it("returns the first result on a retry with the same clientId", async () => {
    const db = setup();
    await performCheckin(db, actor, req());
    expect(await performCheckin(db, actor, req())).toMatchObject({ code: "duplicate", xp: 100 });
  });

  it("pays repeat XP, no pioneer bonus on a recently visited spot, and keeps firstAt", async () => {
    const db = setup({ lastCheckinAt: { toMillis: () => NOW - 1000 }, checkinCount: 4, name: 7 });
    db.seed("users/u1/xpMarkers/spot_s1", { kind: "spot" });
    const first = new Date(NOW - 5 * 86_400_000);
    db.seed("users/u1/passport/s1", { lastDay: "2026-10-01", count: 2, firstAt: first });
    const out = await performCheckin(db, actor, req());
    expect(out).toMatchObject({ code: "ok", xp: REPEAT_XP, newSpot: false, pioneer: false });
    expect(db.docs.get("users/u1/passport/s1")).toMatchObject({ count: 3, firstAt: first, spotName: "Spot" });
    expect(db.docs.get("spots/s1")).toMatchObject({ checkinCount: 5 });
  });

  it("pays the pioneer bonus when the last check-in is older than 30 days (Date)", async () => {
    const db = setup({ lastCheckinAt: new Date(NOW - PIONEER_IDLE_MS) });
    expect((await performCheckin(db, actor, req())).pioneer).toBe(true);
  });

  it("gives no pioneer bonus on your own spot", async () => {
    const db = setup({ createdBy: "u1", lastCheckinAt: NOW - PIONEER_IDLE_MS - 1 });
    expect(await performCheckin(db, actor, req())).toMatchObject({ xp: NEW_SPOT_XP, pioneer: false });
  });

  it("stamps without XP when the server XP switch is off", async () => {
    const db = setup();
    const out = await performCheckin(db, { ...actor, xpOn: false }, req());
    expect(out).toMatchObject({ code: "ok", xp: 0, pioneer: false });
    expect(db.docs.get("users/u1")).toEqual({ xp: 0 });
  });

  it("respects the daily XP cap and the same-day bucket", async () => {
    const db = setup({}, { xp: 10, xpDay: "2026-10-17", xpToday: 2990 });
    expect((await performCheckin(db, actor, req())).xp).toBe(10);
    const full = setup({}, { xp: 10, xpDay: "2026-10-17", xpToday: 3000 });
    expect((await performCheckin(full, actor, req())).xp).toBe(0);
    const yesterday = setup({}, { xpDay: "2026-10-16", xpToday: 3000 });
    expect((await performCheckin(yesterday, actor, req())).xp).toBe(100);
  });

  it("skips the XP write when the user doc is missing", async () => {
    const db = setup({}, null);
    expect(await performCheckin(db, actor, req())).toMatchObject({ code: "ok", xp: 100 });
    expect(db.docs.has("users/u1")).toBe(false);
  });

  it("awards a legendary badge once", async () => {
    const db = setup({ isLegendary: true, legendaryBadgeId: "legend_el_toro" });
    const out = await performCheckin(db, actor, req());
    expect(out.badgeId).toBe("legend_el_toro");
    expect(db.docs.get("users/u1/achievements/legend_el_toro")).toMatchObject({ reason: "Checked in at El Toro." });
    expect(db.docs.get("users/u1/passport/s1")).toMatchObject({ legendary: true });
    const again = await performCheckin(db, actor, req({ clientId: "c2", clientAt: NOW + 86_400_000 }));
    expect(again.code).toBe("stale");
  });

  it("does not re-award a badge already held, and names unnamed spots", async () => {
    const db = setup({ isLegendary: true, legendaryBadgeId: "legend_x", name: null });
    db.seed("users/u1/achievements/legend_x", { reason: "old" });
    expect((await performCheckin(db, actor, req())).badgeId).toBeNull();
    const fresh = setup({ isLegendary: true, legendaryBadgeId: "legend_x", name: null });
    await performCheckin(fresh, actor, req());
    expect(fresh.docs.get("users/u1/achievements/legend_x")).toMatchObject({
      reason: "Checked in at a legendary spot.",
    });
  });

  it("ignores a malformed badge id", async () => {
    const db = setup({ isLegendary: true, legendaryBadgeId: "Bad Id" });
    expect((await performCheckin(db, actor, req())).badgeId).toBeNull();
  });

  it.each([
    ["stale (too old)", req({ clientAt: NOW - MAX_QUEUE_AGE_MS - 1 }), "stale"],
    ["stale (future)", req({ clientAt: NOW + 10 * 60_000 }), "stale"],
    ["low accuracy", req({ accuracyM: 151 }), "low_accuracy"],
    ["too far", req({ lat: LAT + 0.002 }), "too_far"],
  ])("rejects %s", async (_name, r, code) => {
    expect((await performCheckin(setup(), actor, r)).code).toBe(code);
  });

  it("rejects missing, inactive, closed, and coordinate-less spots", async () => {
    expect((await performCheckin(new MemoryDb(), actor, req())).code).toBe("not_found");
    expect((await performCheckin(setup({ isActive: false }), actor, req())).code).toBe("not_allowed");
    expect((await performCheckin(setup({ checkinsAllowed: false }), actor, req())).code).toBe("not_allowed");
    expect((await performCheckin(setup({ latitude: "x" }), actor, req())).code).toBe("not_found");
  });

  it("enforces the once-per-spot-per-day cooldown", async () => {
    const db = setup();
    expect((await performCheckin(db, actor, req())).code).toBe("ok");
    expect((await performCheckin(db, actor, req({ clientId: "c2" }))).code).toBe("cooldown_spot");
  });

  it("never stores an exact time at a spot in public-readable docs", async () => {
    const db = setup();
    await performCheckin(db, actor, req());
    const stamp = db.docs.get("users/u1/passport/s1") as Record<string, unknown>;
    expect(stamp).not.toHaveProperty("lastAt");
    expect(stamp).not.toHaveProperty("lastDay");
    expect(stamp).not.toHaveProperty("lat");
    const first = (stamp.firstAt as Date).getTime();
    expect(new Date(first).getUTCDate()).toBe(1);
    expect(first % 86_400_000).toBe(0);
    const spot = db.docs.get("spots/s1") as Record<string, unknown>;
    expect((spot.lastCheckinAt as Date).getTime() % 86_400_000).toBe(0);
  });

  it("enforces the hourly cap and resets it after an hour", async () => {
    const db = setup();
    db.seed("mapState/u1", { hourStart: NOW - 1000, hourCount: 12 });
    expect((await performCheckin(db, actor, req())).code).toBe("cooldown_hour");
    db.seed("mapState/u1", { hourStart: NOW - 3_600_001, hourCount: 12 });
    expect((await performCheckin(db, actor, req())).code).toBe("ok");
    expect(db.docs.get("mapState/u1")).toMatchObject({ hourStart: NOW, hourCount: 1 });
  });

  it("marks a mock location suspect and adds a strike", async () => {
    const db = setup();
    const out = await performCheckin(db, actor, req({ mocked: true }));
    expect(out).toMatchObject({ code: "suspect", xp: 0, rewardsPaused: false });
    expect(db.docs.get("mapState/u1")).toMatchObject({ strikes: 1, lastStrikeAt: NOW, hourCount: 1 });
    expect(db.docs.get("users/u1/checkins/c1")).toMatchObject({ verdict: "suspect", reason: "mock_location" });
    expect(db.docs.has("users/u1/passport/s1")).toBe(false);
  });

  it("flags teleporting as too fast, and pauses rewards on the third strike", async () => {
    const db = setup();
    db.seed("mapState/u1", {
      lastLat: LAT + 1,
      lastLng: LNG,
      lastAt: NOW - 60_000,
      strikes: 2,
      lastStrikeAt: NOW - 1000,
      hourStart: NOW - 10,
      hourCount: 1,
    });
    const out = await performCheckin(db, actor, req());
    expect(out).toMatchObject({ code: "suspect", rewardsPaused: true });
    expect(db.docs.get("mapState/u1")).toMatchObject({ strikes: 3, blockedUntil: NOW + pauseMs(3), hourCount: 2 });
    expect(db.docs.get("users/u1/checkins/c1")).toMatchObject({ reason: "too_fast" });
  });

  it("treats a same-instant jump as too fast, and keeps an existing pause", async () => {
    const db = setup();
    db.seed("mapState/u1", { lastLat: LAT + 0.01, lastLng: LNG, lastAt: NOW, blockedUntil: NOW + 5 });
    expect(await performCheckin(db, actor, req())).toMatchObject({ code: "suspect", rewardsPaused: true });
    expect(db.docs.get("mapState/u1")).toMatchObject({ strikes: 1, blockedUntil: NOW + 5 });
  });

  it("forgets strikes after 30 days and allows a plausible trip", async () => {
    const db = setup();
    db.seed("mapState/u1", {
      lastLat: LAT + 0.1,
      lastLng: LNG,
      lastAt: { toMillis: () => NOW - 3_600_000 },
      strikes: 5,
      lastStrikeAt: NOW - 31 * 86_400_000,
    });
    expect((await performCheckin(db, actor, req())).code).toBe("ok");
    expect(db.docs.get("mapState/u1")).toMatchObject({ strikes: 0, lastLat: LAT });
  });

  it("ignores an unreadable lastAt", async () => {
    const db = setup();
    db.seed("mapState/u1", { lastLat: 0, lastLng: 0, lastAt: "bad" });
    expect((await performCheckin(db, actor, req())).code).toBe("ok");
  });

  it("stamps but pays nothing while rewards are paused", async () => {
    const db = setup({ isLegendary: true, legendaryBadgeId: "legend_x" });
    db.seed("mapState/u1", { blockedUntil: NOW + 1000 });
    const out = await performCheckin(db, actor, req());
    expect(out).toMatchObject({ code: "ok", xp: 0, badgeId: null, rewardsPaused: true });
    expect(db.docs.has("users/u1/passport/s1")).toBe(true);
  });

  describe("private spots", () => {
    function priv(spot: Record<string, unknown>): MemoryDb {
      const db = setup();
      db.seed("privateSpots/p1", { name: "Secret", latitude: LAT, longitude: LNG, isActive: true, ...spot });
      return db;
    }
    const r = req({ scope: "private", spotId: "p1" });

    it("lets the owner check in, stamps a prefixed passport, pays nothing", async () => {
      const db = priv({ createdBy: "u1", visibility: "private" });
      expect(await performCheckin(db, actor, r)).toMatchObject({ code: "ok", xp: 0, newSpot: true, pioneer: false });
      expect(db.docs.get("users/u1/passport/p_p1")).toMatchObject({ scope: "private" });
      expect(db.docs.has("users/u1/xpMarkers/spot_p1")).toBe(false);
    });
    it("lets crew check in at a crew spot", async () => {
      const db = priv({ createdBy: "o", visibility: "crew", crewUids: ["u1"] });
      expect((await performCheckin(db, actor, r)).code).toBe("ok");
    });
    it("blocks strangers", async () => {
      expect((await performCheckin(priv({ createdBy: "o", visibility: "crew", crewUids: [] }), actor, r)).code).toBe(
        "not_allowed",
      );
      expect((await performCheckin(priv({ createdBy: "o", visibility: "crew" }), actor, r)).code).toBe("not_allowed");
      expect((await performCheckin(priv({ createdBy: "o", visibility: "private" }), actor, r)).code).toBe(
        "not_allowed",
      );
    });
  });
});
