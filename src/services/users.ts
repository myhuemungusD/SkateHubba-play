import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  increment,
  query,
  where,
  orderBy,
  limit,
  runTransaction,
  writeBatch,
  serverTimestamp,
  type FieldValue,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { deleteGameVideos } from "./storage";
import { deleteUserClips } from "./clips";

/**
 * Public profile doc at `users/{uid}`. Every signed-in user can read
 * this (needed for opponent lookup, leaderboards, the player
 * directory). It MUST NOT contain sensitive fields — those live in
 * {@link UserPrivateProfile} at `users/{uid}/private/profile` and are
 * owner-only readable.
 *
 * Guardrail: adding a field here exposes it cross-user. If the field
 * is PII or account-state (email, dob, push tokens, verification
 * flags, …) put it on UserPrivateProfile instead. `firestore.rules`
 * blocks those field names from appearing at the top level.
 */
export interface UserProfile {
  uid: string;
  username: string;
  stance: string;
  /** serverTimestamp() on write; Firestore Timestamp on read. */
  createdAt: FieldValue | null;
  /** Denormalized leaderboard stats — updated atomically when games complete. */
  wins?: number;
  losses?: number;
  /** ID of the last game that updated this user's stats (idempotency key). */
  lastStatsGameId?: string;
  /** Whether this user is a verified pro. Only settable via Admin SDK / Firebase console. */
  isVerifiedPro?: boolean;
  /** UID of the user or admin who granted verified-pro status. */
  verifiedBy?: string;
  /** Timestamp when pro status was granted (serverTimestamp on write, Firestore Timestamp on read). */
  verifiedAt?: FieldValue | null;
}

/**
 * Private profile doc at `users/{uid}/private/profile`. Readable and
 * writable only by the owning user per `firestore.rules`. Holds every
 * field that would leak PII / account state if exposed cross-user.
 *
 * `fcmTokens` lives here (not on the public doc) so a signed-in
 * attacker cannot scrape other users' push-registration tokens and
 * target them with impersonated push notifications.
 *
 * Note: email is intentionally NOT mirrored here. Firebase Auth is the
 * canonical store for email — every consumer that needs it already
 * reads `auth.currentUser.email`. Duplicating it on Firestore would
 * create a second source of truth and invite drift (e.g. an owner
 * who changed their email in Auth but not Firestore). If a future
 * owner-facing feature legitimately needs an email snapshot at signup
 * time, add the field here and write it from `createProfile` at that
 * time — not speculatively.
 */
export interface UserPrivateProfile {
  /** Auth emailVerified flag mirrored at profile creation time. */
  emailVerified: boolean;
  /** Date of birth in YYYY-MM-DD format (collected at age gate for COPPA/CCPA compliance). */
  dob?: string;
  /** Whether parental consent was given (for users 13-17 at signup). */
  parentalConsent?: boolean;
  /**
   * Firebase Cloud Messaging registration tokens for this user's
   * devices. Written by `requestPushPermission` / `removeFcmToken`.
   * Owner-only readable. Rules cap this list at ≤10 entries.
   */
  fcmTokens?: string[];
}

/** Document id of the canonical private profile doc. */
export const PRIVATE_PROFILE_DOC_ID = "profile" as const;

/**
 * Get user profile by UID. Returns the PUBLIC profile doc — readable
 * by any signed-in user for opponent lookup. Use {@link
 * getUserPrivateProfile} to read the owner-only private doc.
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await withRetry(() => getDoc(doc(requireDb(), "users", uid)));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

/**
 * Get the owner-only private profile doc at
 * `users/{uid}/private/profile`. Must be called while authenticated
 * as `uid` — any other caller is denied by Firestore rules.
 *
 * Returns null when the doc doesn't exist (e.g. pre-migration users
 * whose private fields haven't been backfilled).
 */
export async function getUserPrivateProfile(uid: string): Promise<UserPrivateProfile | null> {
  const snap = await withRetry(() => getDoc(doc(requireDb(), "users", uid, "private", PRIVATE_PROFILE_DOC_ID)));
  return snap.exists() ? (snap.data() as UserPrivateProfile) : null;
}

/** Username constraints — shared between validation, creation, and UI. */
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const USERNAME_RE = /^[a-z0-9_]+$/;

/**
 * Check if a username is available.
 * Returns false for invalid usernames without hitting Firestore.
 */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const normalized = username.toLowerCase().trim();
  if (normalized.length < USERNAME_MIN || normalized.length > USERNAME_MAX) return false;
  if (!USERNAME_RE.test(normalized)) return false;

  const snap = await withRetry(() => getDoc(doc(requireDb(), "usernames", normalized)));
  return !snap.exists();
}

/**
 * Create user profile with atomic username reservation.
 * Uses a Firestore transaction to prevent race conditions:
 *   1. Check usernames/{username} doesn't exist
 *   2. Write usernames/{username} = { uid }
 *   3. Write users/{uid} = full profile
 */
/** DOB must be ISO-8601 YYYY-MM-DD — matches the shape the age gate emits. */
const DOB_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Thrown by createProfile when no valid dob is supplied. UI code looks for
 *  this error name to redirect users to /age-gate instead of showing a raw
 *  validation message. */
export class AgeVerificationRequiredError extends Error {
  constructor() {
    super("Age verification required — complete age-gate before creating a profile");
    this.name = "AgeVerificationRequiredError";
  }
}

export async function createProfile(
  uid: string,
  username: string,
  stance: string,
  emailVerified = false,
  dob?: string,
  parentalConsent?: boolean,
): Promise<UserProfile> {
  const normalized = username.toLowerCase().trim();

  // COPPA: a profile must never be created without age verification. Callers
  // that skipped /age-gate (deep-links to /auth, Google sign-in without the
  // gate) are rejected here — the service is the canonical enforcement point.
  if (!dob || !DOB_RE.test(dob)) {
    throw new AgeVerificationRequiredError();
  }

  if (normalized.length < USERNAME_MIN || normalized.length > USERNAME_MAX) {
    throw new Error(`Username must be ${USERNAME_MIN}–${USERNAME_MAX} characters`);
  }
  if (!USERNAME_RE.test(normalized)) {
    throw new Error("Username may only contain lowercase letters, numbers, and underscores");
  }

  const db = requireDb();
  const profile = await runTransaction(db, async (tx) => {
    const usernameRef = doc(db, "usernames", normalized);
    const usernameSnap = await tx.get(usernameRef);

    if (usernameSnap.exists()) {
      throw new Error("Username is already taken");
    }

    tx.set(usernameRef, { uid, reservedAt: serverTimestamp() });

    // Public profile — readable by every signed-in user. Must not
    // contain PII (email/dob) or account state (emailVerified,
    // fcmTokens); those fields live on the owner-only private doc
    // below. `firestore.rules` rejects any write that tries to put
    // them at the top level.
    const userRef = doc(db, "users", uid);
    const profileData: UserProfile = {
      uid,
      username: normalized,
      stance,
      createdAt: serverTimestamp(),
    };
    tx.set(userRef, profileData);

    // Private profile — owner-only. Holds emailVerified + dob +
    // optional parentalConsent today; future sensitive fields
    // (email, fcmTokens) get written here via dedicated updates.
    const privateRef = doc(db, "users", uid, "private", PRIVATE_PROFILE_DOC_ID);
    const privateData: UserPrivateProfile = {
      emailVerified,
      dob,
      ...(parentalConsent !== undefined ? { parentalConsent } : {}),
    };
    tx.set(privateRef, privateData);

    return profileData;
  });

  return profile;
}

/**
 * Delete a user's Firestore data: game documents, profile, and username reservation.
 *
 * Called AFTER deleteAccount() from auth.ts. If this fails, the auth
 * account is already gone and Firestore data is orphaned — the caller
 * should log/alert so it can be cleaned up manually or via a Cloud Function.
 *
 * Active games are preserved so the opponent isn't affected mid-game.
 *
 * Phase 1: Delete video files from Storage for non-active games.
 * Phase 2: Delete non-active game documents.
 * Phase 3: Delete clips authored by this user (App Store / GDPR cascade).
 * Phase 4: Atomically delete profile + username reservation + private
 *         profile doc (where sensitive fields live since the
 *         public-doc privacy split).
 */
export async function deleteUserData(uid: string, username: string): Promise<void> {
  const db = requireDb();

  // Phase 1 & 2: Find all games, delete videos then game docs for non-active ones
  const gamesCol = collection(db, "games");
  const [asP1, asP2] = await Promise.all([
    getDocs(query(gamesCol, where("player1Uid", "==", uid))),
    getDocs(query(gamesCol, where("player2Uid", "==", uid))),
  ]);
  const seen = new Set<string>();
  const nonActiveGameIds: string[] = [];
  for (const snap of [...asP1.docs, ...asP2.docs]) {
    if (!seen.has(snap.id)) {
      seen.add(snap.id);
      const data = snap.data();
      if (data.status !== "active") {
        nonActiveGameIds.push(snap.id);
      }
    }
  }

  // Phase 1: Delete video files from Storage (best-effort)
  await Promise.all(nonActiveGameIds.map((gameId) => deleteGameVideos(gameId)));

  // Phase 2: Delete game documents
  await Promise.all(nonActiveGameIds.map((gameId) => deleteDoc(doc(db, "games", gameId))));

  // Phase 3: Scrub clips authored by this user from the feed. Best-effort —
  // the owner-delete rule in firestore.rules only allows deleting your own
  // clips, so this runs before the auth/profile teardown.
  await deleteUserClips(uid);

  // Phase 4: Delete profile + username + private profile doc atomically
  // (no reads needed, batch is cheaper). The private doc must be
  // deleted BEFORE the parent users/{uid} doc goes, so the owner's
  // auth context still resolves isOwner(uid) cleanly against the
  // private-subcollection rule.
  const batch = writeBatch(db);
  batch.delete(doc(db, "users", uid, "private", PRIVATE_PROFILE_DOC_ID));
  batch.delete(doc(db, "users", uid));
  batch.delete(doc(db, "usernames", username.toLowerCase().trim()));
  await batch.commit();
}

/**
 * Fetch all user profiles for the player directory.
 * Capped at 100 for MVP. No real-time listener needed —
 * this is fetched once when the Lobby mounts.
 */
export async function getPlayerDirectory(): Promise<UserProfile[]> {
  const q = query(collection(requireDb(), "users"), orderBy("createdAt", "desc"), limit(100));
  const snap = await withRetry(() => getDocs(q));
  return snap.docs.map((d) => d.data() as UserProfile);
}

/**
 * Look up a UID by username (for challenging opponents)
 */
export async function getUidByUsername(username: string): Promise<string | null> {
  const normalized = username.toLowerCase().trim();
  const snap = await withRetry(() => getDoc(doc(requireDb(), "usernames", normalized)));
  if (!snap.exists()) return null;
  const data = snap.data();
  return typeof data.uid === "string" ? data.uid : null;
}

/**
 * Atomically update a player's win/loss stats after a game completes.
 * Uses lastStatsGameId as an idempotency key to prevent double-counting
 * when subscriptions fire multiple times for the same game.
 *
 * The read-then-write is wrapped in a Firestore transaction so the
 * idempotency check and the increment commit as one unit. Without the
 * transaction, two tabs (or the client + the Cloud Function fallback)
 * can both read `lastStatsGameId !== gameId`, then both fire
 * `increment(1)` and the win/loss counter gets bumped twice for the
 * same game. The re-read inside the tx makes the loser of a contention
 * race see the winner's updated lastStatsGameId and bail cleanly.
 *
 * Each player's client calls this for their OWN profile only.
 */
export async function updatePlayerStats(uid: string, gameId: string, won: boolean): Promise<void> {
  const db = requireDb();
  const userRef = doc(db, "users", uid);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists()) return; // profile deleted
    // Idempotency re-checked inside the tx — a parallel writer that
    // won the race will have already committed the new lastStatsGameId.
    if (snap.data().lastStatsGameId === gameId) return;
    tx.update(userRef, {
      [won ? "wins" : "losses"]: increment(1),
      lastStatsGameId: gameId,
    });
  });
}

/**
 * Fetch user profiles for the leaderboard, sorted by wins descending.
 * Falls back to client-side sorting since existing users may lack the wins field.
 * Capped at 50 to keep payload and read costs low.
 */
export async function getLeaderboard(): Promise<UserProfile[]> {
  const q = query(collection(requireDb(), "users"), orderBy("wins", "desc"), limit(50));
  const snap = await withRetry(() => getDocs(q));
  const profiles = snap.docs.map((d) => d.data() as UserProfile);

  return profiles.sort((a, b) => {
    const aWins = a.wins ?? 0;
    const bWins = b.wins ?? 0;
    if (bWins !== aWins) return bWins - aWins;
    const aTotal = aWins + (a.losses ?? 0);
    const bTotal = bWins + (b.losses ?? 0);
    const aRate = aTotal > 0 ? aWins / aTotal : 0;
    const bRate = bTotal > 0 ? bWins / bTotal : 0;
    if (bRate !== aRate) return bRate - aRate;
    return a.username.localeCompare(b.username);
  });
}
