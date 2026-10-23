import {
  containsObjectionableText,
  OBJECTIONABLE_COMMENT_MESSAGE,
  OBJECTIONABLE_TEXT_MESSAGE,
} from "../utils/objectionable";
/**
 * Firestore service for the skate spots feature.
 *
 * Per charter 2.2, the map runs entirely on Firestore — no custom backend,
 * no REST API, Firebase security rules are the authorization layer. This
 * module is the single entry point for all spot CRUD from the client;
 * components never import `firebase/firestore` directly.
 *
 * Data model
 * ──────────
 *   spots/{spotId}                      — top-level collection
 *     createdBy, name, description, latitude, longitude, gnarRating,
 *     bustRisk, obstacles[], photoUrls[], isVerified, isActive,
 *     createdAt, updatedAt
 *
 *   spots/{spotId}/comments/{commentId} — per-spot comment thread
 *     userId, content, createdAt
 *
 * Bounding-box query strategy
 * ───────────────────────────
 * Firestore only supports inequality filters on a single field per query,
 * so we bound by latitude on the server and filter by longitude + isActive
 * client-side. This uses the default single-field index on `latitude`
 * (no composite index required) and scales cleanly into the tens of
 * thousands of spots. Past that, swap in a geohash range query — that's
 * a post-MVP optimization tracked in the audit follow-up list.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit as limitFn,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { isMapCheckinsEnabled } from "../lib/featureFlags";
import type { CreateSpotRequest, ObstacleType, Spot, SpotComment } from "../types/spot";
import { logger } from "./logger";
import { captureException } from "../lib/sentry";
import { parseFirebaseError } from "../utils/helpers";
import { boundsAroundPoint, haversineKm, type LatLng } from "../utils/geo";

/* ────────────────────────────────────────────
 * Constants
 * ──────────────────────────────────────────── */

/** Max spots returned from a single bounds query. Matches the old API cap. */
const BOUNDS_QUERY_LIMIT = 500;

/** Default search radius for the "spots near me" list. */
export const NEARBY_RADIUS_KM = 10;

/** Default row cap for the "spots near me" list. */
export const NEARBY_LIMIT = 10;

/** 30-second client-side cooldown on spot creation (matches Firestore rule). */
const SPOT_CREATE_COOLDOWN_MS = 30_000;

/** Canonical UUID shape used for client-side spotId validation. */
const SPOT_ID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_OBSTACLES: ReadonlyArray<ObstacleType> = [
  "ledge",
  "rail",
  "stairs",
  "gap",
  "bank",
  "bowl",
  "manual_pad",
  "quarter_pipe",
  "euro_gap",
  "slappy_curb",
  "hip",
  "hubba",
  "flatground",
  "other",
];

/* ────────────────────────────────────────────
 * Refs
 * ──────────────────────────────────────────── */

function spotsRef() {
  return collection(requireDb(), "spots");
}

function spotRef(spotId: string) {
  return doc(requireDb(), "spots", spotId);
}

function commentsRef(spotId: string) {
  return collection(requireDb(), "spots", spotId, "comments");
}

/* ────────────────────────────────────────────
 * Doc parsers
 * ──────────────────────────────────────────── */

/** Runtime guard — keeps the service honest about malformed Firestore docs. */
function isObstacleArray(v: unknown): v is ObstacleType[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && VALID_OBSTACLES.includes(x as ObstacleType));
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

/**
 * Convert a Firestore field that we expect to be a Timestamp into an ISO
 * string. Uses structural detection rather than `instanceof Timestamp`
 * because the latter is brittle across multiple Firebase SDK instances
 * (and across vitest's module-mock boundary).
 */
function timestampToIso(v: unknown): string {
  if (v && typeof v === "object" && "toDate" in v) {
    const toDate = (v as { toDate: unknown }).toDate;
    if (typeof toDate === "function") {
      const d = toDate.call(v);
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
    }
  }
  // A just-written serverTimestamp read before the server resolves it —
  // extremely rare in practice but possible. Use now as a best-effort.
  return new Date().toISOString();
}

/** Parse a `spots/{id}` snapshot into a typed `Spot`. Throws on malformed data. */
function toSpot(snap: { id: string; data: () => Record<string, unknown> }): Spot {
  const raw = snap.data();
  if (
    typeof raw.createdBy !== "string" ||
    typeof raw.name !== "string" ||
    typeof raw.latitude !== "number" ||
    typeof raw.longitude !== "number" ||
    typeof raw.gnarRating !== "number" ||
    typeof raw.bustRisk !== "number" ||
    typeof raw.isVerified !== "boolean" ||
    typeof raw.isActive !== "boolean"
  ) {
    throw new Error(`Malformed spot document: ${snap.id}`);
  }
  return {
    id: snap.id,
    createdBy: raw.createdBy,
    name: raw.name,
    description: typeof raw.description === "string" ? raw.description : null,
    latitude: raw.latitude,
    longitude: raw.longitude,
    gnarRating: raw.gnarRating as Spot["gnarRating"],
    bustRisk: raw.bustRisk as Spot["bustRisk"],
    obstacles: isObstacleArray(raw.obstacles) ? raw.obstacles : [],
    photoUrls: isStringArray(raw.photoUrls) ? raw.photoUrls : [],
    isVerified: raw.isVerified,
    isActive: raw.isActive,
    createdAt: timestampToIso(raw.createdAt),
    updatedAt: timestampToIso(raw.updatedAt),
    ...mapFields(raw),
  };
}

/** Map Phase 1 fields, only present when set (keeps older spots' shape unchanged). */
function mapFields(raw: Record<string, unknown>): Partial<Spot> {
  const out: Partial<Spot> = {};
  if (raw.source === "user" || raw.source === "osm" || raw.source === "curated") out.source = raw.source;
  if (raw.kind === "spot" || raw.kind === "park" || raw.kind === "shop") out.kind = raw.kind;
  if (raw.isLegendary === true) out.isLegendary = true;
  if (typeof raw.checkinCount === "number") out.checkinCount = raw.checkinCount;
  return out;
}

/** Seeded spots (OpenStreetMap, curated legendary list) stay hidden until map check-ins are switched on. */
function seededHidden(spot: Spot): boolean {
  return !isMapCheckinsEnabled() && (spot.source === "osm" || spot.source === "curated");
}

/** Parse a `spots/{id}/comments/{commentId}` snapshot into a typed `SpotComment`. */
function toComment(spotId: string, snap: { id: string; data: () => Record<string, unknown> }): SpotComment {
  const raw = snap.data();
  if (typeof raw.userId !== "string" || typeof raw.content !== "string") {
    throw new Error(`Malformed spot_comment document: ${snap.id}`);
  }
  return {
    id: snap.id,
    spotId,
    userId: raw.userId,
    ...(typeof raw.username === "string" && raw.username.length > 0 ? { username: raw.username } : {}),
    content: raw.content,
    createdAt: timestampToIso(raw.createdAt),
  };
}

/* ────────────────────────────────────────────
 * Client-side rate limiting (defense in depth)
 * ──────────────────────────────────────────── */

let lastSpotCreatedAt = 0;

/** @internal Reset rate-limit state (for tests only) */
export function _resetCreateSpotRateLimit(): void {
  lastSpotCreatedAt = 0;
}

/* ────────────────────────────────────────────
 * Validation helpers
 * ──────────────────────────────────────────── */

function isValidRating(v: unknown): v is 1 | 2 | 3 | 4 | 5 {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

function isValidPhotoUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function validateCreateRequest(req: CreateSpotRequest): string | null {
  if (!req.name || typeof req.name !== "string" || req.name.trim().length === 0) {
    return "name is required";
  }
  if (req.name.length > 80) return "name must be 80 characters or less";
  if (containsObjectionableText(req.name)) return OBJECTIONABLE_TEXT_MESSAGE;
  if (req.description != null) {
    if (typeof req.description !== "string") return "description must be a string";
    if (req.description.length > 500) return "description must be 500 characters or less";
    if (containsObjectionableText(req.description)) return OBJECTIONABLE_TEXT_MESSAGE;
  }
  if (typeof req.latitude !== "number" || !Number.isFinite(req.latitude) || req.latitude < -90 || req.latitude > 90) {
    return "latitude must be a finite number between -90 and 90";
  }
  if (
    typeof req.longitude !== "number" ||
    !Number.isFinite(req.longitude) ||
    req.longitude < -180 ||
    req.longitude > 180
  ) {
    return "longitude must be a finite number between -180 and 180";
  }
  if (!isValidRating(req.gnarRating)) return "gnarRating must be 1-5";
  if (!isValidRating(req.bustRisk)) return "bustRisk must be 1-5";
  if (!Array.isArray(req.obstacles) || req.obstacles.some((o) => !VALID_OBSTACLES.includes(o))) {
    return "obstacles contains invalid values";
  }
  if (!Array.isArray(req.photoUrls)) return "photoUrls must be an array";
  if (req.photoUrls.length > 5) return "photoUrls max 5";
  if (req.photoUrls.some((url) => !isValidPhotoUrl(url))) return "photoUrls must contain valid https URLs";
  return null;
}

/* ────────────────────────────────────────────
 * createSpot
 * ──────────────────────────────────────────── */

export async function createSpot(req: CreateSpotRequest, uid: string): Promise<Spot> {
  // Client-side rate limit — the rules enforce the same invariant server-side.
  if (Date.now() - lastSpotCreatedAt < SPOT_CREATE_COOLDOWN_MS) {
    throw new Error("Please wait before adding another spot");
  }

  const error = validateCreateRequest(req);
  if (error) throw new Error(error);

  const payload = {
    createdBy: uid,
    name: req.name.trim(),
    description: req.description?.trim() ?? null,
    latitude: req.latitude,
    longitude: req.longitude,
    gnarRating: req.gnarRating,
    bustRisk: req.bustRisk,
    obstacles: req.obstacles,
    photoUrls: req.photoUrls,
    isVerified: false,
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  // Atomic spot create + cooldown anchor. The spots create rule requires
  // getAfter(users/{uid}).lastSpotCreatedAt == request.time, so the anchor
  // write is MANDATORY and must land in the same batch as the spot.
  const db = requireDb();
  const docRef = doc(spotsRef());
  const batch = writeBatch(db);
  batch.set(docRef, payload);
  batch.set(doc(db, "users", uid), { lastSpotCreatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  lastSpotCreatedAt = Date.now();

  // Optimistic return — populate timestamps locally since the server-resolved
  // values aren't available until the next read. Callers that need authoritative
  // timestamps should re-fetch via `getSpot(docRef.id)`.
  const nowIso = new Date().toISOString();
  return {
    id: docRef.id,
    createdBy: uid,
    name: payload.name,
    description: payload.description,
    latitude: payload.latitude,
    longitude: payload.longitude,
    gnarRating: payload.gnarRating,
    bustRisk: payload.bustRisk,
    obstacles: payload.obstacles,
    photoUrls: payload.photoUrls,
    isVerified: false,
    isActive: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

/* ────────────────────────────────────────────
 * getSpot
 * ──────────────────────────────────────────── */

export async function getSpot(spotId: string): Promise<Spot | null> {
  if (!SPOT_ID_SHAPE.test(spotId)) return null;
  try {
    const snap = await getDoc(spotRef(spotId));
    if (!snap.exists()) return null;
    const spot = toSpot(snap);
    return spot.isActive ? spot : null;
  } catch (err) {
    logger.warn("get_spot_failed", { spotId, error: parseFirebaseError(err) });
    captureException(err, { tags: { op: "getSpot" }, extra: { spotId } });
    return null;
  }
}

/* ────────────────────────────────────────────
 * fetchSpotName — narrow helper kept for ChallengeScreen compatibility
 * ──────────────────────────────────────────── */

/**
 * Resolve a spot id to its display name. Returns `null` on any failure —
 * this is a decoration-only lookup and must never block the core flow.
 * The optional `signal` is honored at the resolve step so a ChallengeScreen
 * unmount doesn't drop a late setState onto a dead component.
 */
export async function fetchSpotName(spotId: string, signal?: AbortSignal): Promise<string | null> {
  if (signal?.aborted) return null;
  const spot = await getSpot(spotId);
  if (signal?.aborted) return null;
  return spot?.name ?? null;
}

/* ────────────────────────────────────────────
 * getSpotsInBounds
 * ──────────────────────────────────────────── */

export interface SpotBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * Fetch active spots inside the given viewport.
 *
 * The query must include `where('isActive', '==', true)` because the
 * Firestore read rule restricts visibility to active spots — Firestore
 * rejects collection queries whose filters can't satisfy the rule at
 * query time. This requires a composite index on `(isActive, latitude)`,
 * declared in firestore.indexes.json. Longitude is filtered client-side
 * because Firestore only allows inequality filters on a single field.
 */
export async function getSpotsInBounds(bounds: SpotBounds): Promise<Spot[]> {
  const { north, south, east, west } = bounds;
  if (
    !Number.isFinite(north) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(west) ||
    north < south
  ) {
    throw new Error("Invalid bounds");
  }

  const q = query(
    spotsRef(),
    where("isActive", "==", true),
    orderBy("latitude"),
    where("latitude", ">=", south),
    where("latitude", "<=", north),
    limitFn(BOUNDS_QUERY_LIMIT),
  );

  const snap = await getDocs(q);
  const spots: Spot[] = [];
  for (const docSnap of snap.docs) {
    try {
      const spot = toSpot(docSnap);
      if (spot.longitude < west || spot.longitude > east) continue;
      if (seededHidden(spot)) continue;
      spots.push(spot);
    } catch (err) {
      // Skip malformed docs — log once and keep the feed live.
      logger.warn("malformed_spot_in_bounds", {
        docId: docSnap.id,
        error: parseFirebaseError(err),
      });
    }
  }
  return spots;
}

/* ────────────────────────────────────────────
 * getSpotsNearby
 * ──────────────────────────────────────────── */

export interface NearbySpot extends Spot {
  /** Great-circle distance from the query point, in kilometres. */
  distanceKm: number;
}

/**
 * Closest active spots to `center`, nearest first, within `radiusKm`.
 *
 * Reuses the bounds query (and its existing composite index) by wrapping the
 * radius in a bounding box, then trims the box corners with a haversine
 * check client-side.
 *
 * Scaling caveat, inherited from `getSpotsInBounds`: only latitude is bounded
 * server-side, so the Firestore query is a worldwide latitude band (~0.18°
 * tall for 10 km), longitude is filtered after the fact, and the 500-doc cap
 * applies to that band ordered south→north. Once more than 500 active spots
 * exist in the same band anywhere on Earth, the user's own nearby spots can
 * fall outside the returned page. That is the trigger for the geohash
 * migration noted in the module header; it is not a concern at current data
 * volumes.
 */
export async function getSpotsNearby(
  center: LatLng,
  radiusKm: number = NEARBY_RADIUS_KM,
  limit: number = NEARBY_LIMIT,
): Promise<NearbySpot[]> {
  if (
    !Number.isFinite(center.lat) ||
    !Number.isFinite(center.lng) ||
    !Number.isFinite(radiusKm) ||
    radiusKm <= 0 ||
    !Number.isInteger(limit) ||
    limit <= 0
  ) {
    throw new Error("Invalid nearby query");
  }

  const spots = await getSpotsInBounds(boundsAroundPoint(center, radiusKm));
  const nearby: NearbySpot[] = [];
  for (const spot of spots) {
    const distanceKm = haversineKm(center, { lat: spot.latitude, lng: spot.longitude });
    if (distanceKm <= radiusKm) nearby.push({ ...spot, distanceKm });
  }
  nearby.sort((a, b) => a.distanceKm - b.distanceKm);
  return nearby.slice(0, limit);
}

/* ────────────────────────────────────────────
 * listSpotsByCreator
 * ──────────────────────────────────────────── */

/** Cap for the profile "spots you've added" list. Newest first. */
const CREATOR_SPOTS_LIMIT = 50;

/**
 * Active spots created by `uid`, newest first.
 *
 * The read rule is `isSignedIn() && isActive == true`. A query that only
 * filters `createdBy` is rejected, because Firestore cannot prove every
 * matching doc is active. Both filters are required; `createdAt` desc needs
 * the composite index in `firestore.indexes.json`.
 */
export async function listSpotsByCreator(uid: string): Promise<Spot[]> {
  if (typeof uid !== "string" || uid.length === 0) return [];

  const q = query(
    spotsRef(),
    where("createdBy", "==", uid),
    where("isActive", "==", true),
    orderBy("createdAt", "desc"),
    limitFn(CREATOR_SPOTS_LIMIT),
  );

  const snap = await getDocs(q);
  const spots: Spot[] = [];
  for (const docSnap of snap.docs) {
    try {
      const spot = toSpot(docSnap);
      if (spot.createdBy === uid && spot.isActive) spots.push(spot);
    } catch (err) {
      logger.warn("malformed_spot_by_creator", {
        uid,
        docId: docSnap.id,
        error: parseFirebaseError(err),
      });
    }
  }
  return spots;
}

/* ────────────────────────────────────────────
 * Comments
 * ──────────────────────────────────────────── */

export async function getSpotComments(spotId: string): Promise<SpotComment[]> {
  if (!SPOT_ID_SHAPE.test(spotId)) return [];
  const q = query(commentsRef(spotId), orderBy("createdAt", "desc"), limitFn(50));
  const snap = await getDocs(q);
  const comments: SpotComment[] = [];
  for (const docSnap of snap.docs) {
    try {
      comments.push(toComment(spotId, docSnap));
    } catch (err) {
      logger.warn("malformed_spot_comment", {
        spotId,
        docId: docSnap.id,
        error: parseFirebaseError(err),
      });
    }
  }
  return comments;
}

/**
 * `username` is stored so the thread can show who wrote each comment (the
 * create rule checks it is the author's real handle). Optional: omitting it
 * still posts, and the thread falls back to a neutral label.
 */
export async function addSpotComment(
  spotId: string,
  content: string,
  uid: string,
  username?: string,
): Promise<SpotComment> {
  if (!SPOT_ID_SHAPE.test(spotId)) throw new Error("Invalid spot ID");
  const trimmed = content.trim();
  if (trimmed.length === 0) throw new Error("Comment cannot be empty");
  if (trimmed.length > 300) throw new Error("Comment must be 300 characters or less");
  if (containsObjectionableText(trimmed)) throw new Error(OBJECTIONABLE_COMMENT_MESSAGE);

  // A transaction lets us atomically verify the parent spot exists before
  // writing the comment — prevents orphaned comments if the spot was just
  // soft-deleted between the client check and the write.
  const db = requireDb();
  return runTransaction(db, async (tx) => {
    const parentSnap = await tx.get(spotRef(spotId));
    if (!parentSnap.exists()) throw new Error("Spot not found");
    const commentDocRef = doc(commentsRef(spotId));
    const handle = username ? { username } : {};
    tx.set(commentDocRef, {
      userId: uid,
      ...handle,
      content: trimmed,
      createdAt: serverTimestamp(),
    });
    return {
      id: commentDocRef.id,
      spotId,
      userId: uid,
      ...handle,
      content: trimmed,
      createdAt: new Date().toISOString(),
    } satisfies SpotComment;
  });
}
