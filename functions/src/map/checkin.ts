/**
 * Map check-ins (docs/MAP_ROADMAP.md, Phase 1).
 *
 * The client never writes a check-in. It sends where it thinks it is, and this
 * module decides: distance to the spot, GPS accuracy, travel speed since the
 * last check-in, mock-location flag, cooldowns, and strikes. Rewards (XP, the
 * pioneer bonus, legendary badges) are paid in the same transaction that
 * stamps the passport, so a retry can never pay twice.
 */
import { levelForXp } from "../applyGameStats.js";
import type { DiceDb, DiceTx } from "../dice/store.js";

export const CHECKIN_RADIUS_M = 100;
export const MAX_ACCURACY_M = 150;
/** Faster than this between two check-ins is a teleport, not a car. 45 m/s ≈ 160 km/h. */
export const MAX_SPEED_MPS = 45;
/** Offline check-ins can be sent up to this long after they happened. */
export const MAX_QUEUE_AGE_MS = 6 * 60 * 60 * 1000;
export const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;
export const HOURLY_CAP = 12;
export const NEW_SPOT_XP = 50;
export const REPEAT_XP = 5;
export const PIONEER_XP = 50;
export const PIONEER_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const DAILY_XP_CAP = 3000;
export const STRIKES_TO_PAUSE = 3;
export const STRIKE_RESET_MS = 30 * 24 * 60 * 60 * 1000;
export const PAUSE_BASE_MS = 7 * 24 * 60 * 60 * 1000;
export const PAUSE_MAX_MS = 90 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

export type CheckinScope = "public" | "private";

export interface CheckinRequest {
  spotId: string;
  scope: CheckinScope;
  lat: number;
  lng: number;
  accuracyM: number;
  clientAt: number;
  clientId: string;
  mocked: boolean;
}

export type CheckinCode =
  | "ok"
  | "duplicate"
  | "cooldown_spot"
  | "cooldown_hour"
  | "too_far"
  | "low_accuracy"
  | "suspect"
  | "stale"
  | "not_found"
  | "not_allowed";

export interface CheckinResult {
  code: CheckinCode;
  xp: number;
  newSpot: boolean;
  pioneer: boolean;
  badgeId: string | null;
  rewardsPaused: boolean;
}

export class CheckinInputError extends Error {}

const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/** Validate the raw callable body. Throws CheckinInputError on any bad field. */
export function parseCheckinRequest(raw: unknown): CheckinRequest {
  if (!raw || typeof raw !== "object") throw new CheckinInputError("bad_request");
  const b = raw as Record<string, unknown>;
  const scope = b.scope === undefined ? "public" : b.scope;
  if (typeof b.spotId !== "string" || !ID_SHAPE.test(b.spotId)) throw new CheckinInputError("bad_spot");
  if (scope !== "public" && scope !== "private") throw new CheckinInputError("bad_scope");
  if (!finite(b.lat) || b.lat < -90 || b.lat > 90) throw new CheckinInputError("bad_lat");
  if (!finite(b.lng) || b.lng < -180 || b.lng > 180) throw new CheckinInputError("bad_lng");
  if (!finite(b.accuracyM) || b.accuracyM < 0) throw new CheckinInputError("bad_accuracy");
  if (!finite(b.clientAt)) throw new CheckinInputError("bad_time");
  if (typeof b.clientId !== "string" || !ID_SHAPE.test(b.clientId)) throw new CheckinInputError("bad_client_id");
  return {
    spotId: b.spotId,
    scope,
    lat: b.lat,
    lng: b.lng,
    accuracyM: b.accuracyM,
    clientAt: b.clientAt,
    clientId: b.clientId,
    mocked: b.mocked === true,
  };
}

/** Great-circle distance in meters. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
}

function ms(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v instanceof Date) return v.getTime();
  if (v && typeof v === "object" && typeof (v as { toMillis?: unknown }).toMillis === "function") {
    return (v as { toMillis: () => number }).toMillis();
  }
  return null;
}

/** Pause length after the Nth strike (N ≥ STRIKES_TO_PAUSE): 7 days, doubling, capped at 90. */
export function pauseMs(strikes: number): number {
  if (strikes < STRIKES_TO_PAUSE) return 0;
  return Math.min(PAUSE_MAX_MS, PAUSE_BASE_MS * 2 ** (strikes - STRIKES_TO_PAUSE));
}

export interface CheckinActor {
  uid: string;
  nowMs: number;
  /** Server XP switch (XP_ENABLED / XP_TESTER_UIDS) already resolved for this uid. */
  xpOn: boolean;
}

function result(code: CheckinCode, extra: Partial<CheckinResult> = {}): CheckinResult {
  return { code, xp: 0, newSpot: false, pioneer: false, badgeId: null, rewardsPaused: false, ...extra };
}

export function spotPath(req: Pick<CheckinRequest, "scope" | "spotId">): string {
  return `${req.scope === "private" ? "privateSpots" : "spots"}/${req.spotId}`;
}

/** Passport doc id. Private spots get a prefix so ids from the two collections never collide. */
function dayStartMs(t: number): number {
  return Math.floor(t / 86_400_000) * 86_400_000;
}

function monthStartMs(t: number): number {
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export function passportId(req: Pick<CheckinRequest, "scope" | "spotId">): string {
  return req.scope === "private" ? `p_${req.spotId}` : req.spotId;
}

function canSee(spot: Record<string, unknown>, scope: CheckinScope, uid: string): boolean {
  if (spot.isActive !== true) return false;
  if (spot.checkinsAllowed === false) return false;
  if (scope === "public") return true;
  if (spot.createdBy === uid) return true;
  return spot.visibility === "crew" && Array.isArray(spot.crewUids) && spot.crewUids.includes(uid);
}

function logCheckin(
  tx: DiceTx,
  actor: CheckinActor,
  req: CheckinRequest,
  verdict: "ok" | "suspect",
  reason: string,
  xp: number,
): void {
  tx.set(`users/${actor.uid}/checkins/${req.clientId}`, {
    spotId: req.spotId,
    scope: req.scope,
    verdict,
    reason,
    xp,
    accuracyM: Math.round(req.accuracyM),
    clientAt: new Date(req.clientAt),
    createdAt: new Date(actor.nowMs),
  });
}

/** Decide and apply one check-in. All reads happen before any write. */
export async function performCheckin(db: DiceDb, actor: CheckinActor, req: CheckinRequest): Promise<CheckinResult> {
  const { uid, nowMs } = actor;
  if (req.clientAt > nowMs + MAX_CLOCK_SKEW_MS || req.clientAt < nowMs - MAX_QUEUE_AGE_MS) return result("stale");
  if (req.accuracyM > MAX_ACCURACY_M) return result("low_accuracy");

  return db.runTransaction(async (tx) => {
    const logPath = `users/${uid}/checkins/${req.clientId}`;
    const pPath = `users/${uid}/passport/${passportId(req)}`;
    const statePath = `mapState/${uid}`;
    const dayPath = `users/${uid}/checkins/day.${passportId(req)}.${utcDay(req.clientAt)}`;
    const [prior, spotDoc, passport, stateDoc, userDoc, marker, dayMark] = await Promise.all([
      tx.get(logPath),
      tx.get(spotPath(req)),
      tx.get(pPath),
      tx.get(statePath),
      tx.get(`users/${uid}`),
      tx.get(`users/${uid}/xpMarkers/spot_${req.spotId}`),
      tx.get(dayPath),
    ]);
    if (prior.data) {
      return result("duplicate", { xp: num(prior.data.xp) });
    }
    const spot = spotDoc.data;
    if (!spot) return result("not_found");
    if (!canSee(spot, req.scope, uid)) return result("not_allowed");
    const sLat = spot.latitude;
    const sLng = spot.longitude;
    if (!finite(sLat) || !finite(sLng)) return result("not_found");
    if (distanceM(req.lat, req.lng, sLat, sLng) > CHECKIN_RADIUS_M) return result("too_far");

    const state = stateDoc.data ?? {};
    if (dayMark.data) return result("cooldown_spot");

    const hourStart = num(state.hourStart);
    const inHour = nowMs - hourStart < HOUR_MS;
    const hourCount = inHour ? num(state.hourCount) : 0;
    if (hourCount >= HOURLY_CAP) return result("cooldown_hour");

    // Speed since the previous accepted check-in.
    let tooFast = false;
    const lastAt = ms(state.lastAt);
    if (lastAt !== null && finite(state.lastLat) && finite(state.lastLng)) {
      const dt = Math.abs(req.clientAt - lastAt) / 1000;
      const d = distanceM(req.lat, req.lng, state.lastLat, state.lastLng);
      tooFast = d > CHECKIN_RADIUS_M && (dt === 0 || d / dt > MAX_SPEED_MPS);
    }

    // Second read phase (Firestore needs every read before the first write).
    const legendary = req.scope === "public" && spot.isLegendary === true;
    const badgeCandidate =
      legendary && typeof spot.legendaryBadgeId === "string" && /^legend_[a-z0-9_]{1,60}$/.test(spot.legendaryBadgeId)
        ? spot.legendaryBadgeId
        : null;
    const badgeDoc = badgeCandidate ? await tx.get(`users/${uid}/achievements/${badgeCandidate}`) : null;

    const blockedUntil = num(state.blockedUntil);
    const lastStrikeAt = num(state.lastStrikeAt);
    const strikesBefore = nowMs - lastStrikeAt > STRIKE_RESET_MS ? 0 : num(state.strikes);

    if (req.mocked || tooFast) {
      const strikes = strikesBefore + 1;
      const pause = pauseMs(strikes);
      tx.set(
        statePath,
        {
          strikes,
          lastStrikeAt: nowMs,
          blockedUntil: pause > 0 ? Math.max(blockedUntil, nowMs + pause) : blockedUntil,
          hourStart: inHour ? hourStart : nowMs,
          hourCount: hourCount + 1,
        },
        true,
      );
      logCheckin(tx, actor, req, "suspect", req.mocked ? "mock_location" : "too_fast", 0);
      return result("suspect", { rewardsPaused: pause > 0 || blockedUntil > nowMs });
    }

    const paused = blockedUntil > nowMs;
    const isNew = !marker.data;
    const lastSpotCheckin = ms(spot.lastCheckinAt);
    const pioneer =
      req.scope === "public" &&
      spot.createdBy !== uid &&
      (lastSpotCheckin === null || nowMs - lastSpotCheckin >= PIONEER_IDLE_MS);
    // Private spots stamp the passport but pay nothing: anyone can make one.
    const payable = actor.xpOn && !paused && req.scope === "public";
    let award = 0;
    if (payable) award = (isNew ? NEW_SPOT_XP : REPEAT_XP) + (pioneer ? PIONEER_XP : 0);

    const user = userDoc.data ?? {};
    const sameDay = user.xpDay === utcDay(nowMs);
    const used = sameDay ? num(user.xpToday) : 0;
    const kept = Math.min(award, Math.max(0, DAILY_XP_CAP - used));
    if (kept > 0 && userDoc.data) {
      const nextXp = num(user.xp) + kept;
      tx.update(`users/${uid}`, {
        xp: nextXp,
        level: levelForXp(nextXp),
        xpDay: utcDay(nowMs),
        xpToday: used + kept,
      });
    }
    if (isNew && req.scope === "public") {
      tx.set(`users/${uid}/xpMarkers/spot_${req.spotId}`, { kind: "spot", createdAt: new Date(nowMs) });
    }

    let badgeId: string | null = null;
    if (badgeCandidate && badgeDoc && !badgeDoc.data && !paused) {
      badgeId = badgeCandidate;
      const name = typeof spot.name === "string" ? spot.name : "a legendary spot";
      tx.set(`users/${uid}/achievements/${badgeId}`, {
        // Day precision only: badges are public, so no exact time at a place.
        earnedAt: new Date(dayStartMs(nowMs)),
        reason: `Checked in at ${name}.`.slice(0, 200),
      });
    }

    const at = new Date(req.clientAt);
    tx.set(
      pPath,
      {
        spotId: req.spotId,
        scope: req.scope,
        spotName: typeof spot.name === "string" ? spot.name.slice(0, 80) : "Spot",
        legendary,
        // Month precision only: stamps can be public, so they never say when
        // someone was at a spot. The per-day cooldown lives in owner-only checkins.
        firstAt: passport.data?.firstAt ?? new Date(monthStartMs(at.getTime())),
        count: num(passport.data?.count) + 1,
      },
      true,
    );
    tx.update(spotPath(req), { checkinCount: num(spot.checkinCount) + 1, lastCheckinAt: new Date(dayStartMs(nowMs)) });
    tx.set(dayPath, { createdAt: new Date(nowMs) });
    tx.set(
      statePath,
      {
        lastLat: req.lat,
        lastLng: req.lng,
        lastAt: req.clientAt,
        hourStart: inHour ? hourStart : nowMs,
        hourCount: hourCount + 1,
        strikes: strikesBefore,
        lastStrikeAt,
        blockedUntil,
      },
      true,
    );
    logCheckin(tx, actor, req, "ok", "ok", kept);
    return result("ok", { xp: kept, newSpot: isNew, pioneer: pioneer && payable, badgeId, rewardsPaused: paused });
  });
}
