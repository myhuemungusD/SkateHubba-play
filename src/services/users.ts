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
  type Transaction,
} from "firebase/firestore";
import { ref as storageRef, deleteObject } from "firebase/storage";
import { requireAuth, requireDb, requireStorage } from "../firebase";
import { withRetry } from "../utils/retry";
import { deleteGameVideos } from "./storage";
import { deleteUserClips } from "./clips";
import { analytics } from "./analytics";
import { logger } from "./logger";
import { addBreadcrumb } from "../lib/sentry";
import { isFeatureEnabled } from "./featureFlags";

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
  /**
   * Denormalized leaderboard stats — updated atomically when games complete.
   *
   * @deprecated Kept as a one-release-cycle alias for the new `gamesWon` /
   * `gamesLost` counter fields wired in PR-A1. New code should read the
   * `gamesWon` / `gamesLost` fields below; legacy callers continue to work
   * until the alias is dropped in a follow-up cleanup PR.
   */
  wins?: number;
  /** @deprecated See `wins` above; alias for `gamesLost` until cleanup PR. */
  losses?: number;
  /** ID of the last game that updated this user's stats (idempotency key). */
  lastStatsGameId?: string;
  /** Whether this user is a verified pro. Only settable via Admin SDK / Firebase console. */
  isVerifiedPro?: boolean;
  /** UID of the user or admin who granted verified-pro status. */
  verifiedBy?: string;
  /** Timestamp when pro status was granted (serverTimestamp on write, Firestore Timestamp on read). */
  verifiedAt?: FieldValue | null;

  // ===== Counter fields (PR-A1) =====
  // All optional, default to 0 on read at every call site so legacy profiles
  // (created before PR-A1) keep rendering without a backfill.
  /** Total games this user has won (terminal-miss winner + judge-resolved + opponent forfeited). */
  gamesWon?: number;
  /** Total games lost on a normal terminal (matcher hit 5 letters). */
  gamesLost?: number;
  /** Total games this user forfeited (their own turn deadline expired). */
  gamesForfeited?: number;
  /**
   * Lifetime tricks landed via the honor-system match path. Disputes
   * resolved-clean by a judge intentionally do NOT count — only undisputed
   * landed claims qualify. Capped at +1 per write by the rules layer
   * (PR-A2) and at 6 per game by the service-layer per-game cap.
   */
  tricksLanded?: number;
  /**
   * Per-game trick counter. Reset to 0 on game create for both players;
   * `applyTrickLanded` refuses to increment once it reaches 6 (anti-grinding
   * cap, plan §3.1.3).
   */
  tricksLandedThisGame?: number;
  /** Current win streak — increments on win, resets to 0 on loss OR forfeit (plan §3.1.2). */
  currentWinStreak?: number;
  /** Highest `currentWinStreak` ever observed; monotonic. */
  longestWinStreak?: number;
  /** See plan §3.1.1 — setter credit when matcher's claim was undisputed at game end. */
  cleanJudgments?: number;
  /** Reserved for the future spot-check-in PR; PR-A1 does not write this. */
  spotsAddedCount?: number;
  /** Reserved for the future spot-check-in PR; PR-A1 does not write this. */
  checkInsCount?: number;
  /** Total lifetime XP, capped at 12000 in PR-E. PR-A1 always passes 0. */
  xp?: number;
  /** Derived level (1..30) — wired in PR-E. */
  level?: number;
  /** null = lazy-backfill needed on next own-profile load (PR-A2). */
  statsBackfilledAt?: FieldValue | null;
  /** Custom avatar URL — set by PR-B; null when fallback initials circle should render. */
  profileImageUrl?: string | null;

  // ===== RESERVED — do NOT wire in PR-A1 =====
  // The names below are claimed for upcoming plans so future writers don't
  // collide with current schema. Intentionally NOT redeclared as fields:
  // adding them here would invite premature use and tempt the rules layer
  // to validate fields nothing actually writes.
  //   profileType         — filmer integration
  //   tricksFilmed        — filmer counter
  //   filmCollabsCount    — filmer counter
  //   friendFeedLastSeenAt — in-app friend feed (replaces push)
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
interface UserPrivateProfile {
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
 * by any signed-in user for opponent lookup.
 */
export async function getUserProfile(uid: string): Promise<UserProfile | null> {
  const snap = await withRetry(() => getDoc(doc(requireDb(), "users", uid)));
  return snap.exists() ? (snap.data() as UserProfile) : null;
}

/**
 * Auth-bootstrap variant of {@link getUserProfile}. Firebase Auth fires
 * onAuthStateChanged before the Firestore SDK has always finished
 * propagating the ID token to its auth-state listener, so the very first
 * getDoc on sign-in can return permission-denied even though the user is
 * legitimately signed in. withRetry treats permission-denied as permanent
 * (rightly — normal app code shouldn't retry authz failures), so the
 * initial read throws and returning users get routed through
 * ProfileSetup as if they had no profile.
 *
 * This wrapper force-refreshes the ID token and retries permission-denied
 * across a longer window (~10 s cumulative) with exponential backoff.
 * Each retry force-refreshes the token again so the Firestore SDK
 * eventually observes an up-to-date auth header. The currentUser is
 * resolved from the auth singleton here (not a caller prop) so screens
 * never need to reach into `src/firebase.ts` directly — the services
 * layer owns that boundary.
 *
 * When no matching signed-in user is available (uid mismatch, emulator
 * edge cases) we fall back to a plain getUserProfile call — still
 * correct, just without the retry protection.
 *
 * Every other caller should keep using {@link getUserProfile}.
 */
const AUTH_RETRY_DELAYS_MS = [1500, 3000, 6000] as const;

export async function getUserProfileOnAuth(uid: string): Promise<UserProfile | null> {
  const currentUser = requireAuth().currentUser;
  if (!currentUser || currentUser.uid !== uid) {
    // No live auth context for this uid — the retry logic has nothing
    // useful to do. Fall back to the plain read.
    return await getUserProfile(uid);
  }

  const tryFetch = async (forceRefreshToken: boolean): Promise<UserProfile | null> => {
    try {
      await currentUser.getIdToken(forceRefreshToken);
    } catch {
      // A failed token fetch is best-effort — we still attempt the read
      // because the cached token may be usable.
    }
    return await getUserProfile(uid);
  };

  try {
    return await tryFetch(false);
  } catch (firstErr) {
    const firstCode = (firstErr as { code?: string })?.code ?? "";
    if (firstCode !== "permission-denied" && firstCode !== "unauthenticated") throw firstErr;
    // Permission-denied on the first call is almost always the auth-token
    // propagation race. Back off, force-refresh the ID token, and try a
    // few more times before surfacing the error.
    let lastErr: unknown = firstErr;
    for (const delay of AUTH_RETRY_DELAYS_MS) {
      await new Promise((r) => setTimeout(r, delay));
      try {
        return await tryFetch(true);
      } catch (retryErr) {
        lastErr = retryErr;
        const retryCode = (retryErr as { code?: string })?.code ?? "";
        if (retryCode !== "permission-denied" && retryCode !== "unauthenticated") throw retryErr;
      }
    }
    throw lastErr;
  }
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
    //
    // merge:true is defense-in-depth: the OnboardingProvider gate on
    // activeProfile prevents onboarding writes from landing here before
    // createProfile runs, but a future caller (or a races we haven't
    // anticipated) could write a sibling field — e.g. an FCM token via
    // requestPushPermission — to this doc before profile creation. Without
    // merge, those untouched fields would be silently dropped here.
    const privateRef = doc(db, "users", uid, "private", PRIVATE_PROFILE_DOC_ID);
    const privateData: UserPrivateProfile = {
      emailVerified,
      dob,
      ...(parentalConsent !== undefined ? { parentalConsent } : {}),
    };
    tx.set(privateRef, privateData, { merge: true });

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
  //
  // Achievements subcollection is folded into the same batch so a single
  // commit either wipes the whole identity surface or none of it. Without
  // this, a partial failure could leave orphan achievement docs after the
  // parent user doc was gone — the GDPR/CCPA gap audit B10/S15 calls out.
  const achievementsSnap = await getDocs(collection(db, "users", uid, "achievements"));
  const batch = writeBatch(db);
  for (const achievementDoc of achievementsSnap.docs) {
    batch.delete(achievementDoc.ref);
  }
  batch.delete(doc(db, "users", uid, "private", PRIVATE_PROFILE_DOC_ID));
  batch.delete(doc(db, "users", uid));
  batch.delete(doc(db, "usernames", username.toLowerCase().trim()));
  await batch.commit();

  // Phase 5: Best-effort scrub of avatar binaries from Storage. Three
  // candidate extensions cover the upload code path (`.webp` is the
  // canonical encoding, `.jpeg` and `.png` are fallbacks for browsers
  // that can't encode WebP). `not-found` is the expected case for users
  // who never uploaded a custom avatar — silently ignored. Any other
  // failure is logged but does not throw because the auth + Firestore
  // teardown is already complete.
  const storage = requireStorage();
  const avatarExtensions = ["webp", "jpeg", "png"] as const;
  let avatarRemoved = false;
  await Promise.all(
    avatarExtensions.map(async (ext) => {
      try {
        await deleteObject(storageRef(storage, `users/${uid}/avatar.${ext}`));
        avatarRemoved = true;
      } catch (err) {
        const code = (err as { code?: string })?.code ?? "";
        if (code === "storage/object-not-found") return;
        logger.warn("avatar_delete_failed", {
          uid,
          ext,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );

  analytics.accountDeleted(uid, achievementsSnap.docs.length, avatarRemoved);
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

/* ────────────────────────────────────────────
 * PR-A1: Stats counters wiring
 *
 * `applyGameOutcome` and `applyTrickLanded` are the canonical write paths
 * for the new counter fields. Both are designed to run INSIDE an outer
 * Firestore transaction (the terminal game-update tx in
 * games.match.ts/games.judge.ts/games.turns.ts) so the game-state write
 * and the user-profile write either both land or neither does.
 *
 * Idempotency: `lastStatsGameId` doubles as the dedup key. A second call
 * for the same gameId (e.g. subscription fires twice, or the GameContext
 * catch-up path overlaps with the in-tx write) becomes a silent no-op.
 *
 * Feature flag: gated on `feature.stats_counters_v2`. While the flag is
 * OFF — the default for the staged rollout — every call is a no-op and
 * the staged write count is reported as 0, which the GameContext can use
 * to fall back to the legacy `wins/losses` path until C ships.
 * ──────────────────────────────────────────── */

/**
 * Per-game outcome shape consumed by `applyGameOutcome`. The caller — a
 * terminal game transaction — is responsible for filling these fields
 * from the game doc + auth context. We deliberately do NOT read the game
 * doc inside `applyGameOutcome` to keep the function composable: the
 * caller usually already has the `GameDoc` snapshot in scope.
 */
export interface GameOutcome {
  result: "win" | "loss" | "forfeit";
  /**
   * Number of tricks this user landed during the now-ending game (0..6).
   * Used for telemetry context only — the counter increment is owned by
   * `applyTrickLanded`. Caller computes from `turnHistory` since the
   * per-game count on the user doc is monotonic across the game.
   */
  tricksLandedThisGame: number;
  /**
   * True iff this user was the SETTER on the final turn AND the matcher's
   * claim was uncontested (no judge dispute) AND the game completed
   * normally (status `complete`, not `forfeit`). See plan §3.1.1.
   */
  cleanJudgmentEarned: boolean;
}

/** Feature-flag key for the staged PR-A1 → PR-A2 → … rollout. */
const STATS_COUNTERS_FLAG = "feature.stats_counters_v2" as const;

/**
 * Stage stats writes for `uid` inside the supplied transaction.
 *
 * MUST be called from within `runTransaction` — the function reads the
 * user doc via `tx.get` and stages a single `tx.update`; it never commits.
 * The caller's outer transaction commits both the game doc and the user
 * doc atomically.
 *
 * Returns `{ stagedWrite }` so callers can record telemetry and so a
 * follow-up writer (e.g. the GameContext catch-up path) can know whether
 * a write already landed.
 *
 * Behaviour matrix (plan §3.1.1 / §3.1.2 / §3.1.4):
 *  - flag off              → no-op, stagedWrite=false
 *  - lastStatsGameId match → idempotent no-op, stagedWrite=false
 *  - win                   → gamesWon+1, currentWinStreak+1,
 *                            longestWinStreak=max(prev,new),
 *                            +1 cleanJudgments iff outcome.cleanJudgmentEarned
 *  - loss                  → gamesLost+1, currentWinStreak=0
 *  - forfeit               → gamesForfeited+1, currentWinStreak=0
 *
 * `xpDelta` is plumbed through but always 0 from PR-A1 callers; PR-E
 * activates it. Level recomputation is deferred to PR-E as well — see
 * the placeholder block in the body — so callers passing 0 today see no
 * level change.
 */
export async function applyGameOutcome(
  tx: Transaction,
  uid: string,
  gameId: string,
  outcome: GameOutcome,
  xpDelta: number,
): Promise<{ stagedWrite: boolean }> {
  if (!isFeatureEnabled(STATS_COUNTERS_FLAG, false)) {
    addBreadcrumb({
      category: "stats",
      message: "applyGameOutcome.skipped_flag_off",
      data: { uid, gameId, result: outcome.result },
    });
    analytics.statsCounterSkippedFlagOff(uid);
    return { stagedWrite: false };
  }

  const startedAt = Date.now();
  addBreadcrumb({
    category: "stats",
    message: "applyGameOutcome.start",
    data: { uid, gameId, result: outcome.result },
  });

  try {
    const userRef = doc(requireDb(), "users", uid);
    const snap = await tx.get(userRef);
    if (!snap.exists()) {
      // Profile missing — likely the user deleted their account while a game
      // was in flight (deleteUserData preserves active games on purpose).
      // Silently skip the stats update; tx.update on a missing doc would
      // abort the entire transaction and block turn resolution for the
      // surviving player. Codex P1 review fix.
      addBreadcrumb({
        category: "stats",
        message: "applyGameOutcome.profile_missing",
        data: { uid, gameId },
      });
      return { stagedWrite: false };
    }
    const data = snap.data() as Partial<UserProfile>;

    if (data.lastStatsGameId === gameId) {
      // Idempotent: a previous writer already applied this gameId. Silent
      // no-op so the outer tx still commits its game write cleanly.
      addBreadcrumb({
        category: "stats",
        message: "applyGameOutcome.idempotent_skip",
        data: { uid, gameId },
      });
      analytics.statsCounterIdempotentSkip(uid, gameId);
      return { stagedWrite: false };
    }

    const prevGamesWon = data.gamesWon ?? 0;
    const prevGamesLost = data.gamesLost ?? 0;
    const prevGamesForfeited = data.gamesForfeited ?? 0;
    const prevCurrentStreak = data.currentWinStreak ?? 0;
    const prevLongestStreak = data.longestWinStreak ?? 0;
    const prevCleanJudgments = data.cleanJudgments ?? 0;
    const prevXp = data.xp ?? 0;
    const prevLevel = data.level ?? 1;

    const updates: Record<string, unknown> = {
      lastStatsGameId: gameId,
    };

    if (outcome.result === "win") {
      const nextStreak = prevCurrentStreak + 1;
      updates.gamesWon = prevGamesWon + 1;
      updates.currentWinStreak = nextStreak;
      updates.longestWinStreak = Math.max(prevLongestStreak, nextStreak);
      if (outcome.cleanJudgmentEarned) {
        updates.cleanJudgments = prevCleanJudgments + 1;
      }
    } else if (outcome.result === "loss") {
      updates.gamesLost = prevGamesLost + 1;
      updates.currentWinStreak = 0;
    } else {
      // Forfeit — counter increments on the forfeiter, streak resets per §3.1.2.
      updates.gamesForfeited = prevGamesForfeited + 1;
      updates.currentWinStreak = 0;
    }

    // Placeholder for PR-E: apply xpDelta and recompute `level` via the
    // LEVEL_THRESHOLDS lookup in src/constants/xp.ts. PR-A1 callers always
    // pass 0, so we
    // intentionally leave xp/level untouched here to keep the diff small
    // and the rule surface narrower until PR-E lands the table.
    if (xpDelta > 0) {
      updates.xp = Math.min(prevXp + xpDelta, 12000);
      updates.level = prevLevel; // placeholder — recomputed in PR-E
    }

    tx.update(userRef, updates);

    const txDurationMs = Date.now() - startedAt;
    addBreadcrumb({
      category: "stats",
      message: "applyGameOutcome.finish",
      data: { uid, gameId, result: outcome.result, txDurationMs },
    });
    analytics.statsCounterApplied(
      uid,
      gameId,
      outcome.result,
      outcome.tricksLandedThisGame,
      outcome.cleanJudgmentEarned,
      txDurationMs,
    );

    return { stagedWrite: true };
  } catch (err) {
    addBreadcrumb({
      category: "stats",
      message: "applyGameOutcome.error",
      level: "error",
      data: {
        uid,
        gameId,
        // Non-Error throws are effectively unreachable from the Firestore SDK
        // (always rejects with Error), but the defensive String() coercion
        // keeps logs readable if a non-conformant mock surfaces in tests.
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
}

/**
 * Standalone wrapper around {@link applyGameOutcome} for non-tx callers.
 *
 * Most counter writes piggy-back on the terminal game transaction in
 * `games.match.ts` / `games.judge.ts` / `games.turns.ts`. The outlier is
 * the catch-up path in `GameContext`: when a player observes a completed
 * game from a fresh subscription (e.g. the game ended while they were
 * offline), there is no surrounding transaction to compose into. This
 * helper opens its own `runTransaction` so the same idempotency +
 * feature-flag semantics apply.
 *
 * Idempotent — `applyGameOutcome`'s `lastStatsGameId` check ensures a
 * second call for the same gameId becomes a silent no-op even if it
 * races the in-tx writer from the terminal game transaction.
 */
export async function applyGameOutcomeStandalone(
  uid: string,
  gameId: string,
  outcome: GameOutcome,
  xpDelta: number,
): Promise<{ stagedWrite: boolean }> {
  const db = requireDb();
  return runTransaction(db, (tx) => applyGameOutcome(tx, uid, gameId, outcome, xpDelta));
}

/**
 * Stage a +1 increment on `tricksLanded` (and the per-game cap counter)
 * inside the supplied transaction. Refuses to increment once
 * `tricksLandedThisGame` has reached the per-game cap of 6 — see plan
 * §3.1.3 for the anti-grinding rationale.
 *
 * Like `applyGameOutcome`, this is in-tx-only and feature-flag gated.
 * The clean-landed honor path in `submitMatchAttempt` is the sole
 * caller in PR-A1.
 */
export async function applyTrickLanded(
  tx: Transaction,
  uid: string,
  gameId: string,
): Promise<{ stagedWrite: boolean }> {
  if (!isFeatureEnabled(STATS_COUNTERS_FLAG, false)) {
    addBreadcrumb({
      category: "stats",
      message: "applyTrickLanded.skipped_flag_off",
      data: { uid, gameId },
    });
    analytics.statsCounterSkippedFlagOff(uid);
    return { stagedWrite: false };
  }

  addBreadcrumb({
    category: "stats",
    message: "applyTrickLanded.start",
    data: { uid, gameId },
  });

  try {
    const userRef = doc(requireDb(), "users", uid);
    const snap = await tx.get(userRef);
    if (!snap.exists()) {
      // Profile missing — silently skip rather than abort the outer tx.
      // See applyGameOutcome's matching guard for full rationale (Codex
      // P1 review fix). Account deletion preserves active games, so a
      // landed trick can fire after the profile is gone.
      addBreadcrumb({
        category: "stats",
        message: "applyTrickLanded.profile_missing",
        data: { uid, gameId },
      });
      return { stagedWrite: false };
    }
    const data = snap.data() as Partial<UserProfile>;
    const perGame = data.tricksLandedThisGame ?? 0;
    if (perGame >= 6) {
      addBreadcrumb({
        category: "stats",
        message: "applyTrickLanded.cap_reached",
        data: { uid, gameId, perGame },
      });
      return { stagedWrite: false };
    }
    tx.update(userRef, {
      tricksLanded: increment(1),
      tricksLandedThisGame: increment(1),
    });
    addBreadcrumb({
      category: "stats",
      message: "applyTrickLanded.finish",
      data: { uid, gameId },
    });
    return { stagedWrite: true };
  } catch (err) {
    addBreadcrumb({
      category: "stats",
      message: "applyTrickLanded.error",
      level: "error",
      data: {
        uid,
        gameId,
        // See applyGameOutcome above — defensive String() fallback for the
        // pathological non-Error throw case.
        error: err instanceof Error ? err.message : String(err),
      },
    });
    throw err;
  }
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

/**
 * Build the regex used to validate a Firebase Storage download URL points
 * at the calling user's own avatar. Mirrors the Firestore rule §4.5 word-
 * for-word so a payload that passes the client-side guard also passes the
 * rule — defence in depth, not a duplicated source of truth.
 *
 * Bucket is read from the build-time env so unit tests can exercise the
 * default-emulator bucket and prod can pin `sk8hub-d7806.firebasestorage.app`.
 */
function buildAvatarUrlRegex(uid: string): RegExp {
  // Build env reads as a string; the `?? ""` fallback only fires in
  // misconfigured envs where the entire `import.meta.env` is missing,
  // which the env zod schema guards against at boot. Coverage-skip the
  // fallback because the schema prevents the path in production.
  /* v8 ignore next */
  const bucket = (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined) ?? "";
  // Escape regex metachars in the bucket name (dots most importantly —
  // `sk8hub-d7806.firebasestorage.app` has them and an unescaped dot would
  // accept any char). The uid contains only [A-Za-z0-9] from Firebase Auth
  // but we still escape it for completeness.
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^https://firebasestorage\\.googleapis\\.com/v0/b/${esc(bucket)}/o/users%2F${esc(uid)}%2Favatar\\.(webp|jpeg|png)(\\?.*)?$`,
  );
}

/** Thrown when {@link setProfileImageUrl} is handed a URL that does not
 *  match the project's bucket + the calling user's UID. The Firestore
 *  rule rejects the same payload — this client-side check exists to
 *  surface a clear error before the network round-trip. */
export class InvalidAvatarUrlError extends Error {
  constructor(url: string) {
    super(`Avatar URL is not pinned to this project's bucket and the calling UID: ${url}`);
    this.name = "InvalidAvatarUrlError";
  }
}

/**
 * Persist a user's `profileImageUrl` field. Pass `null` to clear (caller
 * is expected to have already deleted the storage object via
 * `deleteAvatar`). The Firestore rule §4.5 enforces the same predicate
 * server-side; this guard short-circuits the network round-trip and gives
 * the UI a clear typed error to surface.
 *
 * Only the calling user's own profile may be written — the rule pins
 * the URL's UID segment to `request.auth.uid`, so a write against another
 * uid would be rejected even if this function were called with one.
 */
export async function setProfileImageUrl(uid: string, url: string | null): Promise<void> {
  if (url !== null) {
    if (!buildAvatarUrlRegex(uid).test(url)) {
      throw new InvalidAvatarUrlError(url);
    }
  }
  const db = requireDb();
  const ref = doc(db, "users", uid);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) {
      // Profile must exist before an avatar can be attached to it. The
      // ProfileSetup screen creates the profile first; uploading from
      // there pre-creation is not a supported flow.
      throw new Error("avatar_profile_not_found");
    }
    tx.update(ref, { profileImageUrl: url });
  });
}
