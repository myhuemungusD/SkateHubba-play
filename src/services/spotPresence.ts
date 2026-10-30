/**
 * Spot presence client (trainer-battle style spot challenges).
 *
 * After a verified check-in, the app keeps a light foreground location watch
 * on today's spot and sends a heartbeat to the mapPresence callable, which
 * decides whether you're still "here" (within about 500 ft). Leaving the
 * radius marks you away; coming back the same day re-joins you on its own
 * (the day pass) unless auto re-check-in is turned off. Nothing here stores
 * your location: the server only writes "at this spot until".
 *
 * Hide-online also hides spot presence (security audit 2026-10-21, M6): a
 * hidden skater sends no heartbeats (the server refuses to write one anyway),
 * and the who's-here list leaves out anyone whose online status is hidden.
 *
 * Foreground only. iOS and Android pause the web view in the background, so
 * presence simply lapses after the server TTL (`PRESENCE_TTL_MS` in
 * functions/src/map/presence.ts) without a heartbeat.
 */
import { collection, doc, getDoc, onSnapshot, query, Timestamp, where } from "firebase/firestore";
import * as firebase from "../firebase";
import { logger } from "./logger";
import { getHideOnline } from "./onlineStatus";

const PRESENCE_RADIUS_M = 152;
/** Heartbeat while inside the radius. */
export const BEAT_MS = 2 * 60 * 1000;
const AUTO_REJOIN_KEY = "sh_auto_recheckin";
export const ACTIVE_SPOT_KEY = "sh_presence_spot";
export const ACTIVE_SPOT_EVENT = "sh-presence-spot";

type PresenceCode =
  "here" | "away" | "hidden" | "no_pass" | "throttled" | "low_accuracy" | "stale" | "suspect" | "not_found";

export interface PresenceResult {
  code: PresenceCode;
  expiresAt: number | null;
}

export interface ActiveSpot {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  /** UTC day of the check-in that granted the day pass. */
  day: string;
}

export interface SpotSkater {
  uid: string;
  username: string;
}

function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/* ── settings ─────────────────────────────── */

export function getAutoRejoin(): boolean {
  try {
    return localStorage.getItem(AUTO_REJOIN_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setAutoRejoin(on: boolean): void {
  try {
    localStorage.setItem(AUTO_REJOIN_KEY, on ? "on" : "off");
  } catch {
    // Storage blocked: the default (on) stays.
  }
}

/* ── today's spot ─────────────────────────── */

function isActiveSpot(v: unknown): v is ActiveSpot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.name === "string" &&
    typeof s.latitude === "number" &&
    typeof s.longitude === "number" &&
    typeof s.day === "string"
  );
}

/** Today's day-pass spot, or null (none, or it was yesterday's). */
export function readActiveSpot(nowMs: number = Date.now()): ActiveSpot | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ACTIVE_SPOT_KEY) ?? "null");
    return isActiveSpot(parsed) && parsed.day === utcDay(nowMs) ? parsed : null;
  } catch {
    return null;
  }
}

/** Called after a verified check-in so the watcher follows this spot today. */
export function rememberActiveSpot(
  spot: { id: string; name: string; latitude: number; longitude: number },
  nowMs: number = Date.now(),
): void {
  const value: ActiveSpot = {
    id: spot.id,
    name: spot.name,
    latitude: spot.latitude,
    longitude: spot.longitude,
    day: utcDay(nowMs),
  };
  try {
    localStorage.setItem(ACTIVE_SPOT_KEY, JSON.stringify(value));
  } catch {
    // Storage blocked: presence still works until the app reloads.
  }
  window.dispatchEvent(new CustomEvent(ACTIVE_SPOT_EVENT));
}

/**
 * After a check-in: if it granted (or already had) today's pass at a public
 * spot, follow that spot and send the first heartbeat right away.
 */
export function rememberIfPassed(
  spot: { id: string; scope?: string; name?: string; latitude?: number; longitude?: number },
  outcome: { queued: boolean; result?: { code: string } },
  nowMs: number = Date.now(),
): boolean {
  const code = outcome.queued ? null : outcome.result?.code;
  const passed = code === "ok" || code === "duplicate" || code === "cooldown_spot";
  if (!passed || spot.scope === "private" || typeof spot.latitude !== "number" || typeof spot.longitude !== "number") {
    return false;
  }
  rememberActiveSpot(
    { id: spot.id, name: spot.name ?? "Spot", latitude: spot.latitude, longitude: spot.longitude },
    nowMs,
  );
  return true;
}

/* ── callable ─────────────────────────────── */

export async function sendPresence(body: Record<string, unknown>): Promise<PresenceResult> {
  await firebase.ensureAppCheck();
  const [{ getFunctions, httpsCallable, connectFunctionsEmulator }, app] = await Promise.all([
    import("firebase/functions"),
    Promise.resolve(firebase.default),
  ]);
  if (!app) throw new Error("Firebase not initialized");
  const fns = getFunctions(app, "us-central1");
  if (firebase.isEmulatorMode) connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  const res = await httpsCallable(fns, "mapPresence")(body);
  const data = res.data as Partial<PresenceResult> | null;
  if (!data || typeof data.code !== "string") throw new Error("bad response");
  return { code: data.code, expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : null };
}

/** Step away from a spot on purpose (e.g. "Leave spot"). */
export function leaveSpot(spotId: string): Promise<PresenceResult> {
  return sendPresence({ spotId, leave: true });
}

/**
 * Called when the skater turns on "Hide my online status": end today's
 * presence at once instead of letting it lapse. A no-op without an active spot.
 */
export async function hideFromSpot(nowMs: number = Date.now()): Promise<void> {
  const spot = readActiveSpot(nowMs);
  if (spot) await leaveSpot(spot.id);
}

/* ── who's here ───────────────────────────── */

/**
 * The uids (of `uids`) whose online status is hidden. A failed lookup counts
 * as hidden: dropping a visible skater from the list for one refresh is
 * harmless, showing a hidden one is not.
 */
async function hiddenAmong(uids: readonly string[]): Promise<Set<string>> {
  const db = firebase.requireDb();
  const flags = await Promise.all(
    uids.map(async (uid) => {
      try {
        const snap = await getDoc(doc(db, "onlineStatus", uid));
        return snap.exists() && snap.data().hidden === true;
      } catch {
        return true;
      }
    }),
  );
  return new Set(uids.filter((_, i) => flags[i]));
}

function toMillis(v: unknown): number {
  return v instanceof Timestamp ? v.toMillis() : 0;
}

/**
 * Live list of skaters present at a spot (excluding lapsed docs and anyone
 * whose online status is hidden). Re-filters on a timer so someone whose
 * presence lapses drops off without a new write.
 */
export function subscribeSpotSkaters(
  spotId: string,
  onChange: (skaters: SpotSkater[]) => void,
  now: () => number = Date.now,
): () => void {
  const db = firebase.requireDb();
  let latest: { uid: string; username: string; exp: number }[] = [];
  const emit = () => {
    const t = now();
    onChange(latest.filter((s) => s.exp > t).map(({ uid, username }) => ({ uid, username })));
  };
  const q = query(collection(db, "spotPresence", spotId, "here"), where("expiresAt", ">", Timestamp.fromMillis(now())));
  let seq = 0;
  const unsub = onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs.map((d) => {
        const raw = d.data();
        return {
          uid: d.id,
          username: typeof raw.username === "string" ? raw.username : "",
          exp: toMillis(raw.expiresAt),
        };
      });
      const mine = ++seq;
      void hiddenAmong(rows.map((r) => r.uid)).then((hidden) => {
        if (mine !== seq) return; // a newer snapshot already won
        latest = rows.filter((r) => !hidden.has(r.uid));
        emit();
      });
    },
    (err) => {
      logger.warn("spot_presence_list_failed", { code: (err as { code?: string }).code ?? "unknown" });
      seq += 1;
      latest = [];
      emit();
    },
  );
  const timer = setInterval(emit, 30_000);
  return () => {
    clearInterval(timer);
    unsub();
  };
}

/* ── watcher ──────────────────────────────── */

export type WatchStatus = PresenceCode | "locating" | "denied" | "stopped";

export interface WatchDeps {
  geo?: Geolocation | null;
  send?: (body: Record<string, unknown>) => Promise<PresenceResult>;
  now?: () => number;
  autoRejoin?: () => boolean;
  /** Hide-online switch; while it's on, no heartbeat is sent. */
  hidden?: () => boolean;
}

/**
 * Watch the device location for one spot and send throttled heartbeats:
 * immediately when you cross the radius either way, every BEAT_MS while
 * inside, nothing while you stay away. With auto re-check-in off, the first
 * time you leave the watch stops for the day. Returns a stop function.
 */
export function startSpotPresence(
  spot: ActiveSpot,
  onStatus: (status: WatchStatus) => void,
  deps: WatchDeps = {},
): () => void {
  const geo = deps.geo === undefined ? (navigator.geolocation ?? null) : deps.geo;
  const send = deps.send ?? sendPresence;
  const now = deps.now ?? Date.now;
  const autoRejoin = deps.autoRejoin ?? getAutoRejoin;
  const hidden = deps.hidden ?? getHideOnline;
  if (hidden()) {
    // Hidden skaters aren't shown at spots, so don't even watch the location.
    onStatus("hidden");
    return () => {};
  }
  if (!geo) {
    onStatus("denied");
    return () => {};
  }
  let lastInside: boolean | null = null;
  let lastSentAt = 0;
  let inFlight = false;
  let stopped = false;
  let watchId = -1;

  const stop = () => {
    if (stopped) return;
    stopped = true;
    geo.clearWatch(watchId);
  };

  const onFix = (pos: GeolocationPosition) => {
    if (stopped || inFlight) return;
    if (hidden()) {
      // Turned on mid-session: send nothing until it's off again.
      lastInside = null;
      onStatus("hidden");
      return;
    }
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    const t = now();
    const inside = distanceM(lat, lng, spot.latitude, spot.longitude) <= PRESENCE_RADIUS_M;
    const crossed = inside !== lastInside;
    const beatDue = inside && t - lastSentAt >= BEAT_MS;
    // Battery and write budget: nothing is sent between beats unless you cross the line.
    if (!crossed && !beatDue) return;
    inFlight = true;
    const wasInside = lastInside;
    lastInside = inside;
    lastSentAt = t;
    void send({ spotId: spot.id, lat, lng, accuracyM: Math.max(0, accuracy), clientAt: t, mocked: false })
      .then((res) => {
        onStatus(res.code);
        if (res.code === "no_pass" || res.code === "not_found") stop();
        else if (res.code === "away" && wasInside === true && !autoRejoin()) stop();
      })
      .catch((err: unknown) => {
        // Network trouble: try again on the next fix.
        lastInside = wasInside;
        logger.warn("spot_presence_beat_failed", { error: err instanceof Error ? err.message : "unknown" });
      })
      .finally(() => {
        inFlight = false;
      });
  };

  onStatus("locating");
  watchId = geo.watchPosition(
    onFix,
    (err) => {
      if (err.code === 1) {
        onStatus("denied");
        stop();
      }
    },
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
  );
  return () => {
    stop();
    onStatus("stopped");
  };
}
