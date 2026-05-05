import { useCallback, useEffect, useState } from "react";
import {
  TUTORIAL_VERSION,
  getOnboardingState,
  getLocalProgress,
  setLocalProgress,
  clearLocalProgress,
  getLocalDismissed,
  setLocalDismissed,
  markOnboardingCompleted,
  markOnboardingSkipped,
  resetOnboarding,
} from "../services/onboarding";

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

/**
 * Coordinates the tutorial state machine for a single user.
 *
 * Hybrid persistence:
 *  - localStorage holds the current step / seenSteps so navigation between
 *    steps is instantaneous and offline-safe (writes happen on every advance).
 *  - Firestore holds only the completion bit, written on skip/complete.
 *
 * Stale-mount guard: if `uid` changes mid-fetch, the in-flight read from the
 * previous uid is ignored — the latest mount always wins. Same pattern as
 * usePlayerProfile.
 */
export function useOnboarding(uid: string | null, totalSteps: number): UseOnboardingReturn {
  // `fetchedFor` lets us derive `loading` from props + state without a
  // setState-in-effect dance: we're loading exactly when there's a uid AND
  // the most-recent fetch hasn't landed for it yet.
  const [resolved, setResolved] = useState<{
    fetchedFor: string;
    shouldShow: boolean;
    currentStep: number;
  }>({ fetchedFor: "", shouldShow: false, currentStep: 0 });

  useEffect(() => {
    if (!uid) return;

    let stale = false;

    // The local dismissed flag is the device-local short-circuit. We still
    // fetch from Firestore (cheap, picks up cross-device dismissals) but
    // resolve via the local flag immediately if it's set — both paths set
    // shouldShow=false so the tour never re-fires on a refresh.
    const locallyDismissed = getLocalDismissed(uid);

    const fetchPromise = locallyDismissed ? Promise.resolve(null) : getOnboardingState(uid).catch(() => "ERR" as const);

    fetchPromise.then((stateOrErr) => {
      if (stale) return;

      if (locallyDismissed) {
        setResolved({ fetchedFor: uid, shouldShow: false, currentStep: 0 });
        return;
      }

      if (stateOrErr === "ERR") {
        // getOnboardingState already swallows errors and returns null,
        // but defend against a future change in case it ever throws again.
        setResolved({ fetchedFor: uid, shouldShow: true, currentStep: 0 });
        return;
      }

      const state = stateOrErr;
      // Treat the tour as "done" only when the recorded version matches the
      // current TUTORIAL_VERSION. Bumping the constant resurfaces the tour
      // for everyone with stale persisted state.
      const versionMatches = state?.tutorialVersion === TUTORIAL_VERSION;
      const alreadyDone = !!state && versionMatches && (state.completedAt !== null || state.skippedAt !== null);

      if (alreadyDone) {
        // Mirror the Firestore "done" bit into localStorage so future loads
        // on this device skip the network round-trip entirely.
        setLocalDismissed(uid);
        setResolved({ fetchedFor: uid, shouldShow: false, currentStep: 0 });
      } else {
        const local = getLocalProgress(uid);
        const restoredStep = local ? Math.min(Math.max(local.currentStep, 0), totalSteps - 1) : 0;
        setResolved({ fetchedFor: uid, shouldShow: true, currentStep: restoredStep });
      }
    });

    return () => {
      stale = true;
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

  // The localStorage write is intentionally inside the setResolved updater so
  // it observes the SAME `prev` the state machine just transitioned from —
  // critical for double-click correctness: a second advance() before React
  // re-renders sees prev=1 (queued from the first call) and computes 2,
  // keeping persisted state and React state in lockstep. Pulling persistStep
  // out into the closure body would capture a stale `resolved.currentStep`
  // and silently desync.
  //
  // Under React StrictMode the updater can run twice with the same prev,
  // which would write the same value twice — harmless because the writes
  // are idempotent (same key, same JSON payload).
  const advance = useCallback(() => {
    setResolved((prev) => {
      const next = Math.min(prev.currentStep + 1, totalSteps - 1);
      persistStep(next);
      return { ...prev, currentStep: next };
    });
  }, [totalSteps, persistStep]);

  const back = useCallback(() => {
    setResolved((prev) => {
      const next = Math.max(prev.currentStep - 1, 0);
      persistStep(next);
      return { ...prev, currentStep: next };
    });
  }, [persistStep]);

  const skip = useCallback(async () => {
    setResolved((prev) => ({ ...prev, shouldShow: false }));
    if (!uid) return;
    // Synchronous local writes BEFORE the async Firestore call — if the user
    // closes the tab or the network drops, the device-local flag alone is
    // enough to keep the tour from re-firing on reload.
    clearLocalProgress(uid);
    setLocalDismissed(uid);
    await markOnboardingSkipped(uid);
  }, [uid]);

  const complete = useCallback(async () => {
    setResolved((prev) => ({ ...prev, shouldShow: false }));
    if (!uid) return;
    clearLocalProgress(uid);
    setLocalDismissed(uid);
    await markOnboardingCompleted(uid);
  }, [uid]);

  const replay = useCallback(async () => {
    setResolved((prev) => ({ ...prev, shouldShow: true, currentStep: 0 }));
    if (!uid) return;
    await resetOnboarding(uid);
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
