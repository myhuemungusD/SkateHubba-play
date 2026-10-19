/**
 * Spot presence (Pokémon Go trainer-battle style challenges).
 *
 * After a verified check-in, the app sends a small location heartbeat while
 * it is open. This module decides whether the skater is still "here": inside
 * PRESENCE_RADIUS_M of the spot, with a fresh, accurate, non-mocked fix that
 * isn't a teleport. Being here writes spotPresence/{spotId}/here/{uid} with a
 * short expiry; leaving the radius (or going quiet) lets it lapse. The day
 * pass is the check-in's own day mark, so coming back the same day re-joins
 * without a new check-in and without paying XP again.
 *
 * The presence doc never stores a location, only "at this spot until".
 */
import type { DiceDb } from "../dice/store.js";
import { activityPath, isVisible, writeHere, writeLeft } from "./activity.js";
import { CheckinInputError, distanceM, MAX_ACCURACY_M, MAX_CLOCK_SKEW_MS, MAX_SPEED_MPS, utcDay } from "./checkin.js";

/** About 500 ft. */
export const PRESENCE_RADIUS_M = 152;
/** No heartbeat for this long and you're away. */
export const PRESENCE_TTL_MS = 10 * 60 * 1000;
/** Heartbeats closer together than this are ignored (battery and write cost). */
export const MIN_BEAT_MS = 20 * 1000;
/** A heartbeat fix older than this is refused. */
export const MAX_BEAT_AGE_MS = 2 * 60 * 1000;

export interface PresenceRequest {
  spotId: string;
  lat: number;
  lng: number;
  accuracyM: number;
  clientAt: number;
  mocked: boolean;
  leave: boolean;
}

export type PresenceCode =
  "here" | "away" | "no_pass" | "throttled" | "low_accuracy" | "stale" | "suspect" | "not_found";

export interface PresenceResult {
  code: PresenceCode;
  /** When "here" lapses unless another heartbeat lands (ms epoch), else null. */
  expiresAt: number | null;
}

const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

export function parsePresenceRequest(raw: unknown): PresenceRequest {
  if (!raw || typeof raw !== "object") throw new CheckinInputError("bad_request");
  const b = raw as Record<string, unknown>;
  if (typeof b.spotId !== "string" || !ID_SHAPE.test(b.spotId)) throw new CheckinInputError("bad_spot");
  const leave = b.leave === true;
  if (leave) return { spotId: b.spotId, lat: 0, lng: 0, accuracyM: 0, clientAt: 0, mocked: false, leave };
  if (!finite(b.lat) || b.lat < -90 || b.lat > 90) throw new CheckinInputError("bad_lat");
  if (!finite(b.lng) || b.lng < -180 || b.lng > 180) throw new CheckinInputError("bad_lng");
  if (!finite(b.accuracyM) || b.accuracyM < 0) throw new CheckinInputError("bad_accuracy");
  if (!finite(b.clientAt)) throw new CheckinInputError("bad_time");
  return {
    spotId: b.spotId,
    lat: b.lat,
    lng: b.lng,
    accuracyM: b.accuracyM,
    clientAt: b.clientAt,
    mocked: b.mocked === true,
    leave,
  };
}

export function herePath(spotId: string, uid: string): string {
  return `spotPresence/${spotId}/here/${uid}`;
}

function num(v: unknown): number | null {
  return finite(v) ? v : null;
}

/** Decide one heartbeat (or a leave). All reads happen before any write. */
export async function performPresence(
  db: DiceDb,
  actor: { uid: string; nowMs: number },
  req: PresenceRequest,
): Promise<PresenceResult> {
  const { uid, nowMs } = actor;
  const here = herePath(req.spotId, uid);
  const away = (): PresenceResult => ({ code: "away", expiresAt: null });

  if (req.leave) {
    return db.runTransaction(async (tx) => {
      const [cur, activity] = await Promise.all([tx.get(here), tx.get(activityPath(uid))]);
      if (cur.data) tx.set(here, { expiresAt: new Date(nowMs), updatedAt: new Date(nowMs) }, true);
      writeLeft(tx, uid, req.spotId, activity, nowMs);
      return away();
    });
  }
  if (req.clientAt > nowMs + MAX_CLOCK_SKEW_MS || req.clientAt < nowMs - MAX_BEAT_AGE_MS) {
    return { code: "stale", expiresAt: null };
  }
  if (req.accuracyM > MAX_ACCURACY_M) return { code: "low_accuracy", expiresAt: null };

  return db.runTransaction(async (tx) => {
    const statePath = `mapState/${uid}`;
    const [spotDoc, dayMark, stateDoc, userDoc, cur, activity, online] = await Promise.all([
      tx.get(`spots/${req.spotId}`),
      tx.get(`users/${uid}/checkins/day.${req.spotId}.${utcDay(nowMs)}`),
      tx.get(statePath),
      tx.get(`users/${uid}`),
      tx.get(here),
      tx.get(activityPath(uid)),
      tx.get(`onlineStatus/${uid}`),
    ]);
    const spot = spotDoc.data;
    if (!spot || spot.isActive !== true || !finite(spot.latitude) || !finite(spot.longitude)) {
      return { code: "not_found", expiresAt: null };
    }
    if (!dayMark.data) return { code: "no_pass", expiresAt: null };

    const state = stateDoc.data ?? {};
    const lastAt = num(state.presenceAt);
    const sameSpot = state.presenceSpot === req.spotId;
    if (lastAt !== null && sameSpot && nowMs - lastAt < MIN_BEAT_MS) {
      const exp = cur.data?.expiresAt;
      const expMs = exp instanceof Date ? exp.getTime() : null;
      return expMs !== null && expMs > nowMs
        ? { code: "throttled", expiresAt: expMs }
        : { code: "throttled", expiresAt: null };
    }

    let tooFast = false;
    const lastLat = num(state.presenceLat);
    const lastLng = num(state.presenceLng);
    const lastClientAt = num(state.presenceClientAt);
    if (lastLat !== null && lastLng !== null && lastClientAt !== null) {
      const dt = Math.abs(req.clientAt - lastClientAt) / 1000;
      const d = distanceM(req.lat, req.lng, lastLat, lastLng);
      tooFast = d > PRESENCE_RADIUS_M && (dt === 0 || d / dt > MAX_SPEED_MPS);
    }

    const inside = distanceM(req.lat, req.lng, spot.latitude, spot.longitude) <= PRESENCE_RADIUS_M;
    const suspect = req.mocked || tooFast;
    tx.set(
      statePath,
      {
        presenceAt: nowMs,
        presenceSpot: req.spotId,
        // A suspect fix doesn't move the speed anchor, so one spoof can't launder the next.
        ...(suspect ? {} : { presenceLat: req.lat, presenceLng: req.lng, presenceClientAt: req.clientAt }),
      },
      true,
    );

    if (suspect || !inside) {
      if (cur.data) tx.set(here, { expiresAt: new Date(nowMs), updatedAt: new Date(nowMs) }, true);
      writeLeft(tx, uid, req.spotId, activity, nowMs);
      return suspect ? { code: "suspect", expiresAt: null } : away();
    }

    const user = userDoc.data ?? {};
    const expiresAt = nowMs + PRESENCE_TTL_MS;
    const username = typeof user.username === "string" ? user.username.slice(0, 40) : "";
    tx.set(here, {
      uid,
      spotId: req.spotId,
      username,
      expiresAt: new Date(expiresAt),
      updatedAt: new Date(nowMs),
    });
    writeHere(tx, {
      uid,
      username,
      spotId: req.spotId,
      spot,
      nowMs,
      hereUntilMs: expiresAt,
      visible: isVisible(online),
    });
    return { code: "here", expiresAt };
  });
}
