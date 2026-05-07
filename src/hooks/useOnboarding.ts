import { useCallback, useEffect, useRef, useState } from "react";
import {
  TUTORIAL_VERSION,
  subscribeToOnboardingState,
  getLocalProgress,
  setLocalProgress,
  clearLocalProgress,
  getLocalDismissed,
  setLocalDismissed,
  markOnboardingCompleted,
  markOnboardingSkipped,
  resetOnboarding,
  type OnboardingState,
} from "../services/onboarding";
import { logger } from "../services/logger";
import { parseFirebaseError } from "../utils/helpers";

export interface UseOnboardingReturn {
  loading: boolean;
  /** True only when the tour has not yet been completed/skipped at the current TUTORIAL_VERSION. */
  shouldShow: boolean;
  currentStep: number;
  totalSteps: number;
  advance: () => void;
  back: () => void;
  skip: () => Promise<void>;
  complete: () => Promise<void>;
  /** Wipe persistence and re-arm the tour from step 0 (used by Settings → "replay"). */
  replay: () => Promise<void>;
}

const DISMISSED_PREFIX = "skatehubba.onboarding.dismissed.";
const PROGRESS_PREFIX = "skatehubba.onboarding.v";

/**
 * Coordinates the tutorial state machine for a single user.
 *
 * Hybrid persistence:
 *  - localStorage holds the current step / seenSteps so navigation between
 *    steps is instantaneous and offline-safe (writes happen on every advance).
 *  - Firestore holds only the completion bit, written on skip/complete. The
 *    hook subscribes via {@link subscribeToOnboardingState} so a completion
 *    recorded on another device propagates to every open tab.
 *
 * Cross-tab sync: a `storage` listener re-derives state when the dismissed
 * or progress key flips in another tab, keeping the in-memory state machine
 * consistent across windows of the same user.
 *
 * Stale-mount guard: each new uid creates a new subscription with its own
 * cleanup, and intermediate callbacks are gated by `cancelled` so a late
 * snapshot from the previous uid can't write back into the latest mount.
 */
export function useOnboarding(uid: string | null, totalSteps: number): UseOnboardingReturn {
  const [resolved, setResolved] = useState<{
    fetchedFor: string;
    shouldShow: boolean;
    currentStep: number;
  }>({ fetchedFor: "", shouldShow: false, currentStep: 0 });

  useEffect(() => {
    if (!uid) return;

    let cancelled = false;
    let firstSnapshot = true;

    /**
     * Reconcile a fresh OnboardingState (or null) with local-dismissed and
     * local-progress to compute the next resolved state. Called both from
     * the Firestore subscription and from the cross-tab storage listener.
     */
    const reconcile = (state: OnboardingState | null) => {
      if (cancelled) return;
      const locallyDismissed = getLocalDismissed(uid);
      const versionMatches = state?.tutorialVersion === TUTORIAL_VERSION;
      const alreadyDone = !!state && versionMatches && (state.completedAt !== null || state.skippedAt !== null);

      if (alreadyDone || locallyDismissed) {
        if (alreadyDone) setLocalDismissed(uid);
        setResolved({ fetchedFor: uid, shouldShow: false, currentStep: 0 });
        return;
      }

      const local = getLocalProgress(uid);
      const restoredStep = local ? Math.min(Math.max(local.currentStep, 0), Math.max(totalSteps - 1, 0)) : 0;
      // Keep an in-progress step intact across snapshots — only the very
      // first reconcile reseeds the step from local persistence; later
      // snapshots that still say "not done" should not yank the user back
      // to step 0 mid-tour.
      setResolved((prev) => {
        if (prev.fetchedFor === uid && !firstSnapshot) {
          return prev.shouldShow ? prev : { ...prev, shouldShow: true };
        }
        return { fetchedFor: uid, shouldShow: true, currentStep: restoredStep };
      });
      firstSnapshot = false;
    };

    let unsub: (() => void) | undefined;
    try {
      unsub = subscribeToOnboardingState(uid, reconcile);
    } catch (err) {
      // Firestore init failure (rare; covered by getOnboardingState's
      // catch in the previous one-shot model). Fall through to local-only
      // resolution so the UI still moves.
      logger.warn("onboarding_subscribe_init_failed", { error: parseFirebaseError(err) });
      reconcile(null);
    }

    // Cross-tab reconciliation: when another tab writes the local-dismissed
    // key (skip/complete) or replays the tour, mirror that change here so a
    // user with two windows open sees the tour disappear / reappear in
    // lockstep.
    const onStorage = (e: StorageEvent) => {
      if (!e.key) return;
      if (!e.key.startsWith(DISMISSED_PREFIX) && !e.key.startsWith(PROGRESS_PREFIX)) return;
      // We don't have the latest server state cached locally — re-running
      // reconcile with `null` is safe because the local-dismissed flag plus
      // local-progress are sufficient to derive the visible state. The
      // Firestore subscription will fire its own snapshot shortly afterwards
      // and re-apply server-side ground truth.
      reconcile(null);
    };
    window.addEventListener("storage", onStorage);

    return () => {
      cancelled = true;
      window.removeEventListener("storage", onStorage);
      unsub?.();
    };
  }, [uid, totalSteps]);

  const persistStep = useCallback(
    (next: number) => {
      if (!uid) return;
      setLocalProgress(uid, {
        tutorialVersion: TUTORIAL_VERSION,
        currentStep: next,
        seenSteps: Array.from({ length: next + 1 }, (_v, i) => i),
      });
    },
    [uid],
  );

  // Mirror the resolved state into a ref so advance/back can compute the next
  // step without putting `persistStep(next)` inside the setState updater —
  // React StrictMode double-invokes updaters in development and would emit a
  // duplicate localStorage write on every advance/back if the persistence
  // call lived inside the updater body. State updaters must stay pure.
  const resolvedRef = useRef(resolved);
  useEffect(() => {
    resolvedRef.current = resolved;
  }, [resolved]);

  const advance = useCallback(() => {
    const current = resolvedRef.current.currentStep;
    const next = Math.min(current + 1, totalSteps - 1);
    if (next !== current) persistStep(next);
    setResolved((prev) => ({ ...prev, currentStep: next }));
  }, [totalSteps, persistStep]);

  const back = useCallback(() => {
    const current = resolvedRef.current.currentStep;
    const next = Math.max(current - 1, 0);
    if (next !== current) persistStep(next);
    setResolved((prev) => ({ ...prev, currentStep: next }));
  }, [persistStep]);

  const skip = useCallback(async () => {
    setResolved((prev) => ({ ...prev, shouldShow: false }));
    if (!uid) return;
    // Synchronous local writes BEFORE the async Firestore call — if the user
    // closes the tab or the network drops, the device-local flag alone is
    // enough to keep the tour from re-firing on reload.
    clearLocalProgress(uid);
    setLocalDismissed(uid);
    try {
      await markOnboardingSkipped(uid);
    } catch (err) {
      // markOnboardingSkipped already swallows + reports errors, but the
      // promise can still reject if a wrapping mock or instrumentation
      // throws. Logging here keeps the UI moving regardless.
      logger.warn("onboarding_skip_persist_failed", { error: parseFirebaseError(err) });
    }
  }, [uid]);

  const complete = useCallback(async () => {
    setResolved((prev) => ({ ...prev, shouldShow: false }));
    if (!uid) return;
    clearLocalProgress(uid);
    setLocalDismissed(uid);
    try {
      await markOnboardingCompleted(uid);
    } catch (err) {
      logger.warn("onboarding_complete_persist_failed", { error: parseFirebaseError(err) });
    }
  }, [uid]);

  const replay = useCallback(async () => {
    setResolved((prev) => ({ ...prev, shouldShow: true, currentStep: 0 }));
    if (!uid) return;
    try {
      await resetOnboarding(uid);
    } catch (err) {
      logger.warn("onboarding_replay_persist_failed", { error: parseFirebaseError(err) });
    }
  }, [uid]);

  // Loading state: there's a uid AND we don't yet have a fetched result for it.
  const loading = uid !== null && resolved.fetchedFor !== uid;
  // When uid is null, force shouldShow=false even if a previous mount had it true.
  const shouldShow = uid !== null && resolved.shouldShow;
  const currentStep = uid === null ? 0 : resolved.currentStep;

  return {
    loading,
    shouldShow,
    currentStep,
    totalSteps,
    advance,
    back,
    skip,
    complete,
    replay,
  };
}
