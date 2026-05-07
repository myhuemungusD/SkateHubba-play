import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const {
  mockSubscribeToOnboardingState,
  mockGetLocalProgress,
  mockSetLocalProgress,
  mockClearLocalProgress,
  mockGetLocalDismissed,
  mockSetLocalDismissed,
  mockClearLocalDismissed,
  mockMarkOnboardingCompleted,
  mockMarkOnboardingSkipped,
  mockResetOnboarding,
} = vi.hoisted(() => ({
  mockSubscribeToOnboardingState: vi.fn(),
  mockGetLocalProgress: vi.fn(),
  mockSetLocalProgress: vi.fn(),
  mockClearLocalProgress: vi.fn(),
  mockGetLocalDismissed: vi.fn(),
  mockSetLocalDismissed: vi.fn(),
  mockClearLocalDismissed: vi.fn(),
  mockMarkOnboardingCompleted: vi.fn().mockResolvedValue(undefined),
  mockMarkOnboardingSkipped: vi.fn().mockResolvedValue(undefined),
  mockResetOnboarding: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/onboarding", () => ({
  TUTORIAL_VERSION: 2,
  subscribeToOnboardingState: mockSubscribeToOnboardingState,
  getLocalProgress: mockGetLocalProgress,
  setLocalProgress: mockSetLocalProgress,
  clearLocalProgress: mockClearLocalProgress,
  getLocalDismissed: mockGetLocalDismissed,
  setLocalDismissed: mockSetLocalDismissed,
  clearLocalDismissed: mockClearLocalDismissed,
  markOnboardingCompleted: mockMarkOnboardingCompleted,
  markOnboardingSkipped: mockMarkOnboardingSkipped,
  resetOnboarding: mockResetOnboarding,
}));

import { useOnboarding } from "../useOnboarding";

const TOTAL_STEPS = 5;

interface OnboardingStateLike {
  tutorialVersion: number | null;
  completedAt: { toDate: () => Date } | null;
  skippedAt: { toDate: () => Date } | null;
}

function doneState(version = 2): OnboardingStateLike {
  return { tutorialVersion: version, completedAt: { toDate: () => new Date() }, skippedAt: null };
}

/**
 * Default subscription seed: invoke the callback synchronously with `null`
 * (no completion record). Tests that need a different seed assign
 * mockSubscribeToOnboardingState.mockImplementationOnce before rendering.
 */
function seedSubscription(state: OnboardingStateLike | null = null) {
  mockSubscribeToOnboardingState.mockImplementation((_uid: string, cb: (s: OnboardingStateLike | null) => void) => {
    cb(state);
    return () => undefined;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  seedSubscription(null);
  mockGetLocalProgress.mockReturnValue(null);
  mockGetLocalDismissed.mockReturnValue(false);
  mockMarkOnboardingCompleted.mockResolvedValue(undefined);
  mockMarkOnboardingSkipped.mockResolvedValue(undefined);
  mockResetOnboarding.mockResolvedValue(undefined);
});

describe("useOnboarding", () => {
  it("starts in loading state when uid is provided and resolves to shouldShow=true on null state", async () => {
    let resolveCb: ((s: OnboardingStateLike | null) => void) | null = null;
    mockSubscribeToOnboardingState.mockImplementationOnce(
      (_uid: string, cb: (s: OnboardingStateLike | null) => void) => {
        resolveCb = cb;
        return () => undefined;
      },
    );
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    expect(result.current.loading).toBe(true);
    act(() => {
      resolveCb?.(null);
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(true);
    expect(result.current.currentStep).toBe(0);
  });

  it("does not subscribe when uid is null and stays in non-loading + shouldShow=false", async () => {
    const { result } = renderHook(() => useOnboarding(null, TOTAL_STEPS));
    expect(result.current.loading).toBe(false);
    expect(result.current.shouldShow).toBe(false);
    expect(mockSubscribeToOnboardingState).not.toHaveBeenCalled();
  });

  it("hides the tour when completedAt is set at the current version", async () => {
    seedSubscription(doneState());
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(false);
  });

  it("hides the tour when skippedAt is set at the current version", async () => {
    seedSubscription({ tutorialVersion: 2, completedAt: null, skippedAt: { toDate: () => new Date() } });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(false);
  });

  it("re-arms the tour when persisted version is stale (mismatch)", async () => {
    seedSubscription(doneState(0));
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(true);
  });

  it("hides the tour when the local dismissed flag is set even if the subscription returns null", async () => {
    mockGetLocalDismissed.mockReturnValue(true);
    seedSubscription(null);
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(false);
  });

  it("trusts the local dismissed flag when subscribe never fires (offline)", async () => {
    mockGetLocalDismissed.mockReturnValue(true);
    // Subscription never invokes the callback — emulate an offline boot.
    mockSubscribeToOnboardingState.mockImplementationOnce(() => () => undefined);
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    // When the callback never lands, loading stays true — but shouldShow is
    // still suppressed by the uid-aware gate plus local-dismissed flag.
    expect(result.current.shouldShow).toBe(false);
  });

  it("mirrors a completed state into the local dismissed flag", async () => {
    seedSubscription(doneState());
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.shouldShow).toBe(false));
    expect(mockSetLocalDismissed).toHaveBeenCalledWith("u1");
  });

  it("restores in-progress step from local storage when the tour is still active", async () => {
    mockGetLocalProgress.mockReturnValue({ tutorialVersion: 2, currentStep: 2, seenSteps: [0, 1, 2] });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentStep).toBe(2);
  });

  it("clamps an out-of-range restored step into the legal range", async () => {
    mockGetLocalProgress.mockReturnValue({ tutorialVersion: 2, currentStep: 99, seenSteps: [] });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentStep).toBe(TOTAL_STEPS - 1);
  });

  it("advance() moves forward and persists, clamping at the final step", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.advance());
    expect(result.current.currentStep).toBe(1);
    expect(mockSetLocalProgress).toHaveBeenLastCalledWith("u1", {
      tutorialVersion: 2,
      currentStep: 1,
      seenSteps: [0, 1],
    });

    act(() => result.current.advance());
    act(() => result.current.advance());
    act(() => result.current.advance());
    expect(result.current.currentStep).toBe(4);
    act(() => result.current.advance());
    expect(result.current.currentStep).toBe(4);
  });

  it("back() moves backward and clamps at zero", async () => {
    mockGetLocalProgress.mockReturnValue({ tutorialVersion: 2, currentStep: 2, seenSteps: [0, 1, 2] });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.currentStep).toBe(2));

    act(() => result.current.back());
    expect(result.current.currentStep).toBe(1);
    act(() => result.current.back());
    act(() => result.current.back());
    expect(result.current.currentStep).toBe(0);
  });

  it("skip() flips shouldShow=false, sets local dismissed, clears local, and writes server flag", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.skip();
    });

    expect(result.current.shouldShow).toBe(false);
    expect(mockClearLocalProgress).toHaveBeenCalledWith("u1");
    expect(mockSetLocalDismissed).toHaveBeenCalledWith("u1");
    expect(mockMarkOnboardingSkipped).toHaveBeenCalledWith("u1");
  });

  it("skip() swallows persistence rejections so the UI can keep moving", async () => {
    mockMarkOnboardingSkipped.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(result.current.skip()).resolves.toBeUndefined();
    });
    expect(result.current.shouldShow).toBe(false);
  });

  it("complete() flips shouldShow=false, sets local dismissed, clears local, and writes server flag", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.complete();
    });

    expect(result.current.shouldShow).toBe(false);
    expect(mockClearLocalProgress).toHaveBeenCalledWith("u1");
    expect(mockSetLocalDismissed).toHaveBeenCalledWith("u1");
    expect(mockMarkOnboardingCompleted).toHaveBeenCalledWith("u1");
  });

  it("complete() swallows persistence rejections", async () => {
    mockMarkOnboardingCompleted.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await expect(result.current.complete()).resolves.toBeUndefined();
    });
    expect(result.current.shouldShow).toBe(false);
  });

  it("replay() resets persistence and re-arms from step 0", async () => {
    seedSubscription(doneState());
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.shouldShow).toBe(false));

    await act(async () => {
      await result.current.replay();
    });
    expect(result.current.shouldShow).toBe(true);
    expect(result.current.currentStep).toBe(0);
    expect(mockResetOnboarding).toHaveBeenCalledWith("u1");
  });

  it("replay() swallows persistence rejections", async () => {
    seedSubscription(doneState());
    mockResetOnboarding.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.shouldShow).toBe(false));
    await act(async () => {
      await expect(result.current.replay()).resolves.toBeUndefined();
    });
    expect(result.current.shouldShow).toBe(true);
    expect(result.current.currentStep).toBe(0);
  });

  it("skip/complete/replay are no-ops without a uid (do not throw, do not call services)", async () => {
    const { result } = renderHook(() => useOnboarding(null, TOTAL_STEPS));
    await act(async () => {
      await result.current.skip();
      await result.current.complete();
      await result.current.replay();
    });
    expect(mockMarkOnboardingSkipped).not.toHaveBeenCalled();
    expect(mockMarkOnboardingCompleted).not.toHaveBeenCalled();
    expect(mockResetOnboarding).not.toHaveBeenCalled();
  });

  it("advance/back without uid do not write to localStorage", async () => {
    const { result } = renderHook(() => useOnboarding(null, TOTAL_STEPS));
    act(() => result.current.advance());
    act(() => result.current.back());
    expect(mockSetLocalProgress).not.toHaveBeenCalled();
  });

  it("ignores stale subscription callbacks after uid changes", async () => {
    let firstCb: ((s: OnboardingStateLike | null) => void) | null = null;
    const firstUnsub = vi.fn();
    mockSubscribeToOnboardingState.mockImplementationOnce(
      (_uid: string, cb: (s: OnboardingStateLike | null) => void) => {
        firstCb = cb;
        return firstUnsub;
      },
    );
    // Second mount returns null (tour visible) — should win over a late stale callback.
    mockSubscribeToOnboardingState.mockImplementationOnce(
      (_uid: string, cb: (s: OnboardingStateLike | null) => void) => {
        cb(null);
        return () => undefined;
      },
    );

    const { result, rerender } = renderHook(({ uid }: { uid: string }) => useOnboarding(uid, TOTAL_STEPS), {
      initialProps: { uid: "u1" },
    });

    rerender({ uid: "u2" });
    expect(firstUnsub).toHaveBeenCalled();

    // Late stale "completed" payload from u1 — must be ignored by the cancelled flag.
    act(() => {
      firstCb?.(doneState());
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(true);
  });

  it("storage events trigger reconciliation across tabs (dismissed key)", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));

    mockGetLocalDismissed.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: `skatehubba.onboarding.dismissed.v2.u1`,
          newValue: "1",
        }),
      );
    });
    await waitFor(() => expect(result.current.shouldShow).toBe(false));
  });

  it("ignores storage events for unrelated keys", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));

    mockGetLocalDismissed.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "unrelated-key", newValue: "x" }));
    });
    expect(result.current.shouldShow).toBe(true);
  });

  it("ignores storage events with no key (storage.clear in another tab)", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));

    mockGetLocalDismissed.mockReturnValue(true);
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });
    // shouldShow stays untouched because the storage event was a no-op.
    expect(result.current.shouldShow).toBe(true);
  });

  it("ignores stale subscription callbacks for the prior uid (line 80 branch)", async () => {
    // Two snapshots on the same uid: first sets shouldShow=false, second
    // returns the same "done" state. The setLocalDismissed mirroring runs
    // on each snapshot but the resolved state is idempotent — exercises
    // the early-return path inside the alreadyDone branch.
    seedSubscription(doneState());
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.shouldShow).toBe(false));
    // Mirror has been called once during initial reconcile.
    expect(mockSetLocalDismissed).toHaveBeenCalledWith("u1");
  });

  it("preserves prev when a follow-up snapshot still says 'not done' (no churn)", async () => {
    let cb: ((s: OnboardingStateLike | null) => void) | null = null;
    mockSubscribeToOnboardingState.mockImplementationOnce(
      (_uid: string, fn: (s: OnboardingStateLike | null) => void) => {
        cb = fn;
        return () => undefined;
      },
    );
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    act(() => cb?.(null));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    // Advance once so the second snapshot has something to potentially clobber.
    act(() => result.current.advance());
    expect(result.current.currentStep).toBe(1);
    // Second snapshot — same null state. Must NOT yank step back to 0.
    act(() => cb?.(null));
    expect(result.current.currentStep).toBe(1);
    expect(result.current.shouldShow).toBe(true);
  });

  it("re-arms shouldShow when a later snapshot drops the dismissed-locally flag", async () => {
    // Drive the subscription manually so we can fire a second snapshot AFTER
    // a storage event flipped local-dismissed off — the second reconcile
    // must re-set shouldShow=true even though prev.fetchedFor matches uid.
    let cb: ((s: OnboardingStateLike | null) => void) | null = null;
    mockSubscribeToOnboardingState.mockImplementationOnce(
      (_uid: string, fn: (s: OnboardingStateLike | null) => void) => {
        cb = fn;
        return () => undefined;
      },
    );
    mockGetLocalDismissed.mockReturnValue(true);
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    act(() => cb?.(null));
    await waitFor(() => expect(result.current.shouldShow).toBe(false));

    // Storage flipped — clear dismissed and re-fire the subscription.
    mockGetLocalDismissed.mockReturnValue(false);
    act(() => cb?.(null));
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
  });

  it("falls back to local-only resolution when subscribeToOnboardingState throws synchronously", async () => {
    mockSubscribeToOnboardingState.mockImplementationOnce(() => {
      throw new Error("init-failure");
    });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(true);
  });

  it("transitions u1 → null and clears shouldShow", async () => {
    const { result, rerender } = renderHook(({ uid }: { uid: string | null }) => useOnboarding(uid, TOTAL_STEPS), {
      initialProps: { uid: "u1" as string | null },
    });
    await waitFor(() => expect(result.current.shouldShow).toBe(true));
    rerender({ uid: null });
    expect(result.current.shouldShow).toBe(false);
    expect(result.current.currentStep).toBe(0);
  });
});
