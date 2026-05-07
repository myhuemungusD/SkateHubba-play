/**
 * Onboarding tutorial service.
 *
 * Hybrid persistence model:
 *  - localStorage holds in-progress step state (currentStep + seenSteps) so
 *    advancing/backing up between steps is instantaneous and offline-safe.
 *  - Firestore holds the COMPLETION bit on the existing private subcollection
 *    `users/{uid}/private/profile`, which is owner-locked by firestore.rules.
 *    We add three optional fields (onboardingTutorialVersion,
 *    onboardingCompletedAt, onboardingSkippedAt) — no rule change required.
 *
 * Three writes max per tour: optional start, then either skip or complete.
 * Bumping {@link TUTORIAL_VERSION} re-arms the tour for everyone.
 *
 * All writes are best-effort: failures are logged + reported to Sentry but
 * never thrown to the caller — UI keeps moving even if persistence fails so
 * a transient permission-denied or network blip doesn't strand the user.
 */

import { doc, getDoc, onSnapshot, serverTimestamp, setDoc, type Timestamp } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { captureException } from "../lib/sentry";
import { parseFirebaseError } from "../utils/helpers";
import { PRIVATE_PROFILE_DOC_ID } from "./users";

/**
 * Bump this when the tutorial copy/flow changes meaningfully — every user
 * with a stale `onboardingTutorialVersion` will see the tour again on next
 * sign-in. Local progress is namespaced by version too, so old in-progress
 * state from a previous version is ignored automatically.
 */
export const TUTORIAL_VERSION = 2 as const;

export interface OnboardingState {
  tutorialVersion: number | null;
  completedAt: Timestamp | null;
  skippedAt: Timestamp | null;
}

export interface LocalOnboardingProgress {
  tutorialVersion: number;
  currentStep: number;
  seenSteps: number[];
}

/* ────────────────────────────────────────────
 * localStorage helpers
 * ──────────────────────────────────────────── */

function localKey(uid: string): string {
  return `skatehubba.onboarding.v${TUTORIAL_VERSION}.${uid}`;
}

/**
 * Per-device "this user has seen the tour" flag, written eagerly on
 * skip/complete so a closed tab or flaky network can't resurrect the tour
 * on next refresh. Independent of step state — even if step state is wiped
 * (replay, version bump), this key alone never causes the tour to skip:
 * the version bump rewrites it via {@link clearLocalDismissed}.
 */
function localDismissedKey(uid: string): string {
  return `skatehubba.onboarding.dismissed.v${TUTORIAL_VERSION}.${uid}`;
}

function isLocalProgress(v: unknown): v is LocalOnboardingProgress {
  if (!v || typeof v !== "object") return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.tutorialVersion === "number" &&
    typeof obj.currentStep === "number" &&
    Array.isArray(obj.seenSteps) &&
    obj.seenSteps.every((s) => typeof s === "number")
  );
}

export function getLocalProgress(uid: string): LocalOnboardingProgress | null {
  if (!uid) return null;
  try {
    const raw = window.localStorage.getItem(localKey(uid));
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isLocalProgress(parsed)) return null;
    if (parsed.tutorialVersion !== TUTORIAL_VERSION) return null;
    return parsed;
  } catch (err) {
    logger.warn("onboarding_local_read_failed", { error: parseFirebaseError(err) });
    return null;
  }
}

export function setLocalProgress(uid: string, p: LocalOnboardingProgress): void {
  if (!uid) return;
  try {
    window.localStorage.setItem(localKey(uid), JSON.stringify(p));
  } catch (err) {
    logger.warn("onboarding_local_write_failed", { error: parseFirebaseError(err) });
  }
}

export function clearLocalProgress(uid: string): void {
  if (!uid) return;
  try {
    window.localStorage.removeItem(localKey(uid));
  } catch (err) {
    logger.warn("onboarding_local_clear_failed", { error: parseFirebaseError(err) });
  }
}

/** True when the user has dismissed the tour on this device at the current version. */
export function getLocalDismissed(uid: string): boolean {
  if (!uid) return false;
  try {
    return window.localStorage.getItem(localDismissedKey(uid)) === "1";
  } catch {
    return false;
  }
}

/**
 * Mark the tour as dismissed on this device synchronously. Called eagerly
 * before any async Firestore write so a closed tab, network drop, or flaky
 * permission check can't strand the user with a tour that re-fires on
 * every reload.
 */
export function setLocalDismissed(uid: string): void {
  if (!uid) return;
  try {
    window.localStorage.setItem(localDismissedKey(uid), "1");
  } catch (err) {
    logger.warn("onboarding_local_dismiss_failed", { error: parseFirebaseError(err) });
  }
}

export function clearLocalDismissed(uid: string): void {
  if (!uid) return;
  try {
    window.localStorage.removeItem(localDismissedKey(uid));
  } catch {
    /* best-effort */
  }
}

/* ────────────────────────────────────────────
 * Firestore reads/writes
 * ──────────────────────────────────────────── */

function privateProfileRef(uid: string) {
  return doc(requireDb(), "users", uid, "private", PRIVATE_PROFILE_DOC_ID);
}

function isTimestamp(v: unknown): v is Timestamp {
  return !!v && typeof v === "object" && typeof (v as { toDate?: unknown }).toDate === "function";
}

/**
 * Read the persisted completion state. Returns null if the doc is missing,
 * the read fails, or none of the onboarding fields are set yet — callers
 * treat null as "tour not yet completed".
 */
export async function getOnboardingState(uid: string): Promise<OnboardingState | null> {
  if (!uid) return null;
  try {
    const snap = await getDoc(privateProfileRef(uid));
    if (!snap.exists()) return null;
    const data = snap.data();
    const tutorialVersion = typeof data.onboardingTutorialVersion === "number" ? data.onboardingTutorialVersion : null;
    const completedAt = isTimestamp(data.onboardingCompletedAt) ? data.onboardingCompletedAt : null;
    const skippedAt = isTimestamp(data.onboardingSkippedAt) ? data.onboardingSkippedAt : null;
    if (tutorialVersion === null && completedAt === null && skippedAt === null) return null;
    return { tutorialVersion, completedAt, skippedAt };
  } catch (err) {
    logger.warn("onboarding_read_failed", { error: parseFirebaseError(err) });
    captureException(err, { tags: { op: "getOnboardingState" } });
    return null;
  }
}

async function safeWrite(uid: string, payload: Record<string, unknown>, op: string): Promise<void> {
  try {
    await setDoc(privateProfileRef(uid), payload, { merge: true });
  } catch (err) {
    // Persistence failures are non-blocking — the UI continues regardless so
    // a flaky network never strands the user mid-tour. Sentry captures the
    // failure for ops visibility.
    logger.warn("onboarding_write_failed", { op, error: parseFirebaseError(err) });
    captureException(err, { tags: { op } });
  }
}

/**
 * Subscribe to the persisted onboarding state for a single user. Mirrors
 * {@link getOnboardingState} but as a real-time stream so a tour completion
 * recorded on another device propagates instantly to every open tab/session.
 *
 * The callback fires once on initial snapshot and again on every server-side
 * change. Permission errors are logged + swallowed (cb is invoked with null)
 * so the UI never strands the user — same fail-soft posture as getOnboardingState.
 */
export function subscribeToOnboardingState(uid: string, cb: (state: OnboardingState | null) => void): () => void {
  if (!uid) {
    cb(null);
    return () => undefined;
  }
  return onSnapshot(
    privateProfileRef(uid),
    (snap) => {
      if (!snap.exists()) {
        cb(null);
        return;
      }
      const data = snap.data();
      const tutorialVersion =
        typeof data.onboardingTutorialVersion === "number" ? data.onboardingTutorialVersion : null;
      const completedAt = isTimestamp(data.onboardingCompletedAt) ? data.onboardingCompletedAt : null;
      const skippedAt = isTimestamp(data.onboardingSkippedAt) ? data.onboardingSkippedAt : null;
      if (tutorialVersion === null && completedAt === null && skippedAt === null) {
        cb(null);
        return;
      }
      cb({ tutorialVersion, completedAt, skippedAt });
    },
    (err) => {
      logger.warn("onboarding_subscribe_failed", { error: parseFirebaseError(err) });
      captureException(err, { tags: { op: "subscribeToOnboardingState" } });
      cb(null);
    },
  );
}

export async function markOnboardingCompleted(uid: string): Promise<void> {
  if (!uid) return;
  await safeWrite(
    uid,
    {
      onboardingTutorialVersion: TUTORIAL_VERSION,
      onboardingCompletedAt: serverTimestamp(),
      onboardingSkippedAt: null,
    },
    "markOnboardingCompleted",
  );
}

export async function markOnboardingSkipped(uid: string): Promise<void> {
  if (!uid) return;
  await safeWrite(
    uid,
    {
      onboardingTutorialVersion: TUTORIAL_VERSION,
      onboardingCompletedAt: null,
      onboardingSkippedAt: serverTimestamp(),
    },
    "markOnboardingSkipped",
  );
}

/**
 * Wipe both server and local persistence — used by Settings → "replay tour".
 * After this, the next mount of useOnboarding will see no completion state
 * and surface the tour from step 0.
 */
export async function resetOnboarding(uid: string): Promise<void> {
  if (!uid) return;
  clearLocalProgress(uid);
  clearLocalDismissed(uid);
  await safeWrite(
    uid,
    {
      onboardingTutorialVersion: null,
      onboardingCompletedAt: null,
      onboardingSkippedAt: null,
    },
    "resetOnboarding",
  );
}
