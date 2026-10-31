/**
 * Map Phase 1 client (docs/MAP_ROADMAP.md): check-ins, the offline retry
 * queue, the spot passport, and crew-only / private spots.
 *
 * The server decides every check-in (functions/src/map/checkin.ts). This
 * module only asks for the location when the skater taps Check in, sends it,
 * and keeps it in a small local queue when the phone is offline so the
 * check-in still lands once the signal comes back (up to 6 hours later, the
 * server's limit).
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import * as firebase from "../firebase";
import { addBreadcrumb, captureException } from "../lib/sentry";
import { logger } from "./logger";
import type { CreateSpotRequest, Spot } from "../types/spot";

export type CheckinScope = "public" | "private";
export type SpotVisibility = "public" | "crew" | "private";

type CheckinCode =
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

export interface CheckinPayload {
  spotId: string;
  scope: CheckinScope;
  lat: number;
  lng: number;
  accuracyM: number;
  clientAt: number;
  clientId: string;
  mocked: boolean;
}

export type CheckinOutcome = { queued: false; result: CheckinResult } | { queued: true };

export const QUEUE_KEY = "sh_checkin_queue";
export const QUEUE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const QUEUE_MAX = 20;
/** Callable error codes worth retrying later; anything else is final. */
const RETRYABLE = new Set([
  "functions/unavailable",
  "functions/deadline-exceeded",
  "functions/internal",
  "functions/unknown",
]);

/* ── location ─────────────────────────────── */

export class LocationError extends Error {}

/** One fix, asked for only now (never on map load). */
export function getCurrentFix(): Promise<{ lat: number; lng: number; accuracyM: number }> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      reject(new LocationError("Location isn't available on this device."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
      (err) =>
        reject(
          new LocationError(
            err.code === 1
              ? "Allow location to check in. It's only used for this check-in."
              : "Couldn't get your location. Try again.",
          ),
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  });
}

/* ── callable ─────────────────────────────── */

function isResult(v: unknown): v is CheckinResult {
  return !!v && typeof v === "object" && typeof (v as { code?: unknown }).code === "string";
}

function errorCode(err: unknown): string {
  return err && typeof err === "object" && typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : "unknown";
}

export function isRetryable(err: unknown): boolean {
  const code = errorCode(err);
  return RETRYABLE.has(code) || (typeof navigator !== "undefined" && navigator.onLine === false);
}

async function sendCheckin(payload: CheckinPayload): Promise<CheckinResult> {
  await firebase.ensureAppCheck();
  const [{ getFunctions, httpsCallable, connectFunctionsEmulator }, app] = await Promise.all([
    import("firebase/functions"),
    Promise.resolve(firebase.default),
  ]);
  if (!app) throw new Error("Firebase not initialized");
  const fns = getFunctions(app, "us-central1");
  if (firebase.isEmulatorMode) connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  const response = await httpsCallable(fns, "mapCheckin")(payload);
  if (!isResult(response.data)) throw new Error("bad response");
  return response.data;
}

/* ── offline queue ────────────────────────── */

function isPayload(v: unknown): v is CheckinPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.spotId === "string" && typeof p.clientId === "string" && typeof p.clientAt === "number";
}

export function readQueue(): CheckinPayload[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(QUEUE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isPayload) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: CheckinPayload[]): void {
  try {
    if (items.length === 0) localStorage.removeItem(QUEUE_KEY);
    else localStorage.setItem(QUEUE_KEY, JSON.stringify(items.slice(-QUEUE_MAX)));
  } catch {
    // Storage full or blocked: the check-in is lost, which is the same as offline without a queue.
  }
}

function enqueue(payload: CheckinPayload): void {
  writeQueue([...readQueue().filter((p) => p.clientId !== payload.clientId), payload]);
}

let flushing: Promise<CheckinResult[]> | null = null;

/**
 * Send everything queued. Sent and finally-rejected items leave the queue;
 * items that hit another network error stay; anything older than the
 * server's 6-hour window is dropped.
 */
export function flushCheckinQueue(nowMs: number = Date.now()): Promise<CheckinResult[]> {
  if (flushing) return flushing;
  flushing = (async () => {
    const results: CheckinResult[] = [];
    const keep: CheckinPayload[] = [];
    for (const item of readQueue()) {
      if (nowMs - item.clientAt > QUEUE_MAX_AGE_MS) continue;
      try {
        results.push(await sendCheckin(item));
      } catch (err) {
        if (isRetryable(err)) keep.push(item);
        else logger.warn("checkin_queue_dropped", { code: errorCode(err) });
      }
    }
    writeQueue(keep);
    return results;
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

/** Flush now and whenever the browser comes back online. Returns a stop function. */
export function startCheckinQueue(): () => void {
  const onOnline = () => {
    void flushCheckinQueue();
  };
  window.addEventListener("online", onOnline);
  void flushCheckinQueue();
  return () => window.removeEventListener("online", onOnline);
}

function newClientId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Tap Check in: get one location fix, send it, and queue it if the network
 * is down. Location errors are thrown as LocationError for the UI to show.
 */
export async function checkInAtSpot(
  spot: { id: string; scope?: CheckinScope },
  fix: () => Promise<{ lat: number; lng: number; accuracyM: number }> = getCurrentFix,
): Promise<CheckinOutcome> {
  const where_ = await fix();
  const payload: CheckinPayload = {
    spotId: spot.id,
    scope: spot.scope ?? "public",
    lat: where_.lat,
    lng: where_.lng,
    accuracyM: Math.max(0, where_.accuracyM),
    clientAt: Date.now(),
    clientId: newClientId(),
    mocked: false,
  };
  addBreadcrumb({ category: "map", message: "checkin" });
  try {
    return { queued: false, result: await sendCheckin(payload) };
  } catch (err) {
    if (isRetryable(err)) {
      enqueue(payload);
      return { queued: true };
    }
    captureException(err);
    throw err;
  }
}

/** Plain-words message for a check-in result. */
export function describeCheckin(outcome: CheckinOutcome): string {
  if (outcome.queued) return "No signal. Your check-in is saved and will send when you're back online.";
  const r = outcome.result;
  switch (r.code) {
    case "ok":
    case "duplicate": {
      if (r.rewardsPaused) return "Checked in. Map rewards are paused on your account for now.";
      const parts = ["Checked in!"];
      if (r.xp > 0) parts.push(`+${r.xp} XP${r.pioneer ? " (pioneer bonus)" : ""}.`);
      if (r.badgeId) parts.push("Legendary badge earned.");
      return parts.join(" ");
    }
    case "cooldown_spot":
      return "You already checked in here today.";
    case "cooldown_hour":
      return "That's a lot of check-ins. Try again in a bit.";
    case "too_far":
      return "You need to be at the spot (within about 100 m) to check in.";
    case "low_accuracy":
      return "Your GPS signal is too weak. Step into the open and try again.";
    case "stale":
      return "That check-in is too old to count.";
    case "suspect":
      return "That check-in didn't look right, so it doesn't count.";
    default:
      return "You can't check in at this spot.";
  }
}

/* ── passport ─────────────────────────────── */

export interface PassportStamp {
  id: string;
  spotId: string;
  scope: CheckinScope;
  spotName: string;
  legendary: boolean;
  count: number;
  firstAt: Date | null;
}

function toDate(v: unknown): Date | null {
  if (v && typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function") {
    return (v as { toDate: () => Date }).toDate();
  }
  return null;
}

/** Owners see every stamp; others only public-spot stamps (and only if the owner opted in). */
export async function listPassport(uid: string, isOwner: boolean): Promise<PassportStamp[]> {
  const db = firebase.requireDb();
  const ref = collection(db, "users", uid, "passport");
  const snap = await getDocs(isOwner ? ref : query(ref, where("scope", "==", "public")));
  const stamps = snap.docs.map((d) => {
    const raw = d.data();
    return {
      id: d.id,
      spotId: typeof raw.spotId === "string" ? raw.spotId : d.id,
      scope: raw.scope === "private" ? "private" : "public",
      spotName: typeof raw.spotName === "string" ? raw.spotName : "Spot",
      legendary: raw.legendary === true,
      count: typeof raw.count === "number" ? raw.count : 1,
      firstAt: toDate(raw.firstAt),
    } satisfies PassportStamp;
  });
  return stamps.sort((a, b) => (b.firstAt?.getTime() ?? 0) - (a.firstAt?.getTime() ?? 0));
}

export async function getPassportPublic(uid: string): Promise<boolean> {
  const snap = await getDoc(doc(firebase.requireDb(), "passportSettings", uid));
  return snap.exists() && snap.data().public === true;
}

export async function setPassportPublic(uid: string, isPublic: boolean): Promise<void> {
  await setDoc(doc(firebase.requireDb(), "passportSettings", uid), { public: isPublic });
}

/* ── crew-only and private spots ──────────── */

const UUID = newClientId;

/** Resolve crew usernames to uids through usernames/{name}. Unknown names are returned separately. */
export async function resolveCrew(usernames: string[]): Promise<{ uids: string[]; unknown: string[] }> {
  const db = firebase.requireDb();
  const names = [...new Set(usernames.map((n) => n.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))].slice(
    0,
    50,
  );
  const uids: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const snap = await getDoc(doc(db, "usernames", name));
    const uid = snap.exists() ? snap.data().uid : undefined;
    if (typeof uid === "string") uids.push(uid);
    else unknown.push(name);
  }
  return { uids, unknown };
}

export async function createPrivateSpot(
  req: CreateSpotRequest,
  uid: string,
  visibility: Exclude<SpotVisibility, "public">,
  crewUids: string[],
): Promise<Spot> {
  const db = firebase.requireDb();
  const id = UUID();
  const data = {
    createdBy: uid,
    name: req.name,
    description: req.description ?? null,
    latitude: req.latitude,
    longitude: req.longitude,
    gnarRating: req.gnarRating,
    bustRisk: req.bustRisk,
    obstacles: req.obstacles,
    photoUrls: req.photoUrls,
    isVerified: false,
    isActive: true,
    visibility,
    crewUids: visibility === "crew" ? crewUids.slice(0, 50) : [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  batch.set(doc(db, "privateSpots", id), data);
  batch.set(doc(db, "users", uid), { lastSpotCreatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  const now = new Date().toISOString();
  return {
    ...data,
    id,
    description: data.description,
    createdAt: now,
    updatedAt: now,
    scope: "private",
  } as Spot;
}

function toPrivateSpot(d: { id: string; data: () => Record<string, unknown> }): Spot | null {
  const raw = d.data();
  if (typeof raw.name !== "string" || typeof raw.latitude !== "number" || typeof raw.longitude !== "number")
    return null;
  return {
    id: d.id,
    createdBy: typeof raw.createdBy === "string" ? raw.createdBy : "",
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : null,
    latitude: raw.latitude,
    longitude: raw.longitude,
    gnarRating: (typeof raw.gnarRating === "number" ? raw.gnarRating : 1) as Spot["gnarRating"],
    bustRisk: (typeof raw.bustRisk === "number" ? raw.bustRisk : 1) as Spot["bustRisk"],
    obstacles: Array.isArray(raw.obstacles) ? (raw.obstacles as Spot["obstacles"]) : [],
    photoUrls: Array.isArray(raw.photoUrls) ? (raw.photoUrls as string[]) : [],
    isVerified: false,
    isActive: true,
    createdAt: "",
    updatedAt: "",
    scope: "private",
    visibility: raw.visibility === "crew" ? "crew" : "private",
  };
}

/** Your own private and crew spots plus crew spots you were added to. */
export async function listMyPrivateSpots(uid: string): Promise<Spot[]> {
  const db = firebase.requireDb();
  const ref = collection(db, "privateSpots");
  try {
    const [mine, crew] = await Promise.all([
      getDocs(query(ref, where("createdBy", "==", uid), where("isActive", "==", true))),
      getDocs(
        query(
          ref,
          where("crewUids", "array-contains", uid),
          where("visibility", "==", "crew"),
          where("isActive", "==", true),
        ),
      ),
    ]);
    const byId = new Map<string, Spot>();
    for (const d of [...mine.docs, ...crew.docs]) {
      const spot = toPrivateSpot(d);
      if (spot) byId.set(spot.id, spot);
    }
    return [...byId.values()];
  } catch (err) {
    logger.warn("private_spots_load_failed", { error: errorCode(err) });
    return [];
  }
}
