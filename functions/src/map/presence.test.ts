import { describe, expect, it, vi } from "vitest";
import type { DiceDb, DiceDoc, DiceTx } from "../dice/store.js";
import { CheckinInputError, utcDay } from "./checkin.js";
import {
  herePath,
  MIN_BEAT_MS,
  parsePresenceRequest,
  performPresence,
  PRESENCE_TTL_MS,
  type PresenceRequest,
} from "./presence.js";

vi.mock("firebase-functions/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const NOW = Date.UTC(2026, 9, 18, 20, 0, 0);
const LAT = 33.7;
const LNG = -117.8;

class MemoryDb implements DiceDb {
  docs = new Map<string, Record<string, unknown>>();
  seed(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, { ...data });
  }
  async get(path: string): Promise<DiceDoc> {
    const data = this.docs.get(path);
    return { id: path, data: data ? { ...data } : undefined };
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
      update: () => {
        throw new Error("unused");
      },
    };
    return fn(tx);
  }
}

function setup(opts: { pass?: boolean; spot?: Record<string, unknown> | null } = {}): MemoryDb {
  const db = new MemoryDb();
  if (opts.spot !== null) db.seed("spots/s1", opts.spot ?? { isActive: true, latitude: LAT, longitude: LNG });
  if (opts.pass !== false) db.seed(`users/u1/checkins/day.s1.${utcDay(NOW)}`, { createdAt: new Date(NOW) });
  db.seed("users/u1", { username: "jason" });
  return db;
}

function beat(over: Partial<PresenceRequest> = {}): PresenceRequest {
  return { spotId: "s1", lat: LAT, lng: LNG, accuracyM: 10, clientAt: NOW, mocked: false, leave: false, ...over };
}
const actor = { uid: "u1", nowMs: NOW };

describe("parsePresenceRequest", () => {
  it("accepts a heartbeat and a leave", () => {
    expect(parsePresenceRequest({ spotId: "s1", lat: 1, lng: 2, accuracyM: 3, clientAt: 4, mocked: true })).toEqual({
      spotId: "s1",
      lat: 1,
      lng: 2,
      accuracyM: 3,
      clientAt: 4,
      mocked: true,
      leave: false,
    });
    expect(parsePresenceRequest({ spotId: "s1", leave: true }).leave).toBe(true);
  });
  it.each([
    [null, "bad_request"],
    [{ spotId: "a/b" }, "bad_spot"],
    [{ spotId: "s1", lat: 91, lng: 0, accuracyM: 1, clientAt: 1 }, "bad_lat"],
    [{ spotId: "s1", lat: 0, lng: 181, accuracyM: 1, clientAt: 1 }, "bad_lng"],
    [{ spotId: "s1", lat: 0, lng: 0, accuracyM: -1, clientAt: 1 }, "bad_accuracy"],
    [{ spotId: "s1", lat: 0, lng: 0, accuracyM: 1, clientAt: "x" }, "bad_time"],
  ])("rejects %j", (raw, msg) => {
    expect(() => parsePresenceRequest(raw)).toThrow(new CheckinInputError(msg));
  });
});

describe("performPresence", () => {
  it("marks you here without location in the doc", async () => {
    const db = setup();
    await expect(performPresence(db, actor, beat())).resolves.toEqual({
      code: "here",
      expiresAt: NOW + PRESENCE_TTL_MS,
    });
    const doc = db.docs.get(herePath("s1", "u1"));
    expect(doc).toMatchObject({ uid: "u1", spotId: "s1", username: "jason" });
    expect(doc).not.toHaveProperty("lat");
  });
  it("needs today's check-in (the day pass)", async () => {
    await expect(performPresence(setup({ pass: false }), actor, beat())).resolves.toEqual({
      code: "no_pass",
      expiresAt: null,
    });
  });
  it("refuses missing or inactive spots", async () => {
    await expect(performPresence(setup({ spot: null }), actor, beat())).resolves.toMatchObject({ code: "not_found" });
    await expect(
      performPresence(setup({ spot: { isActive: false, latitude: LAT, longitude: LNG } }), actor, beat()),
    ).resolves.toMatchObject({ code: "not_found" });
  });
  it("refuses stale and inaccurate fixes", async () => {
    const db = setup();
    await expect(performPresence(db, actor, beat({ clientAt: NOW - 3 * 60_000 }))).resolves.toMatchObject({
      code: "stale",
    });
    await expect(performPresence(db, actor, beat({ clientAt: NOW + 3 * 60_000 }))).resolves.toMatchObject({
      code: "stale",
    });
    await expect(performPresence(db, actor, beat({ accuracyM: 500 }))).resolves.toMatchObject({
      code: "low_accuracy",
    });
  });
  it("throttles fast heartbeats and reports the live expiry", async () => {
    const db = setup();
    await performPresence(db, actor, beat());
    await expect(
      performPresence(db, { uid: "u1", nowMs: NOW + 1000 }, beat({ clientAt: NOW + 1000 })),
    ).resolves.toEqual({ code: "throttled", expiresAt: NOW + PRESENCE_TTL_MS });
    db.docs.delete(herePath("s1", "u1"));
    await expect(performPresence(db, { uid: "u1", nowMs: NOW + 1000 }, beat())).resolves.toEqual({
      code: "throttled",
      expiresAt: null,
    });
  });
  it("leaving the radius marks you away and returning re-joins (auto re-check-in)", async () => {
    const db = setup();
    await performPresence(db, actor, beat());
    const t1 = NOW + MIN_BEAT_MS + 1;
    // ~300 m north, walking pace over 10 min is fine.
    const far = { lat: LAT + 0.0027, clientAt: t1 };
    await expect(performPresence(db, { uid: "u1", nowMs: t1 }, beat(far))).resolves.toEqual({
      code: "away",
      expiresAt: null,
    });
    expect((db.docs.get(herePath("s1", "u1"))?.expiresAt as Date).getTime()).toBe(t1);
    const t2 = t1 + 10 * 60_000;
    await expect(performPresence(db, { uid: "u1", nowMs: t2 }, beat({ clientAt: t2 }))).resolves.toMatchObject({
      code: "here",
    });
  });
  it("away without a prior doc writes nothing to the spot", async () => {
    const db = setup();
    await performPresence(db, actor, beat({ lat: LAT + 0.01 }));
    expect(db.docs.has(herePath("s1", "u1"))).toBe(false);
  });
  it("flags mocked fixes and teleports", async () => {
    const db = setup();
    await performPresence(db, actor, beat());
    await expect(
      performPresence(
        db,
        { uid: "u1", nowMs: NOW + MIN_BEAT_MS + 1 },
        beat({ mocked: true, clientAt: NOW + MIN_BEAT_MS }),
      ),
    ).resolves.toEqual({ code: "suspect", expiresAt: null });
    const t = NOW + 2 * MIN_BEAT_MS + 2;
    await expect(
      performPresence(db, { uid: "u1", nowMs: t }, beat({ lat: LAT + 1, clientAt: t })),
    ).resolves.toMatchObject({ code: "suspect" });
    const t3 = t + MIN_BEAT_MS + 1;
    // Same clientAt as the anchor and far away: a teleport.
    db.seed("mapState/u1", { presenceLat: LAT, presenceLng: LNG, presenceClientAt: t3, presenceAt: 0 });
    await expect(
      performPresence(db, { uid: "u1", nowMs: t3 }, beat({ lat: LAT + 1, clientAt: t3 })),
    ).resolves.toMatchObject({ code: "suspect" });
  });
  it("handles users without a username", async () => {
    const db = setup();
    db.seed("users/u1", {});
    await performPresence(db, actor, beat());
    expect(db.docs.get(herePath("s1", "u1"))?.username).toBe("");
  });
  it("leave lapses the doc, and is a no-op when you weren't here", async () => {
    const db = setup();
    await expect(performPresence(db, actor, beat({ leave: true }))).resolves.toEqual({ code: "away", expiresAt: null });
    expect(db.docs.has(herePath("s1", "u1"))).toBe(false);
    await performPresence(db, actor, beat());
    await performPresence(db, actor, beat({ leave: true }));
    expect((db.docs.get(herePath("s1", "u1"))?.expiresAt as Date).getTime()).toBe(NOW);
  });
});
