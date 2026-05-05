import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const {
  mockGetOnboardingState,
  mockGetLocalProgress,
  mockSetLocalProgress,
  mockClearLocalProgress,
  mockMarkOnboardingCompleted,
  mockMarkOnboardingSkipped,
  mockResetOnboarding,
} = vi.hoisted(() => ({
  mockGetOnboardingState: vi.fn(),
  mockGetLocalProgress: vi.fn(),
  mockSetLocalProgress: vi.fn(),
  mockClearLocalProgress: vi.fn(),
  mockMarkOnboardingCompleted: vi.fn().mockResolvedValue(undefined),
  mockMarkOnboardingSkipped: vi.fn().mockResolvedValue(undefined),
  mockResetOnboarding: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../services/onboarding", () => ({
  TUTORIAL_VERSION: 1,
  getOnboardingState: mockGetOnboardingState,
  getLocalProgress: mockGetLocalProgress,
  setLocalProgress: mockSetLocalProgress,
  clearLocalProgress: mockClearLocalProgress,
  markOnboardingCompleted: mockMarkOnboardingCompleted,
  markOnboardingSkipped: mockMarkOnboardingSkipped,
  resetOnboarding: mockResetOnboarding,
}));

import { useOnboarding } from "../useOnboarding";

const TOTAL_STEPS = 5;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOnboardingState.mockResolvedValue(null);
  mockGetLocalProgress.mockReturnValue(null);
  mockMarkOnboardingCompleted.mockResolvedValue(undefined);
  mockMarkOnboardingSkipped.mockResolvedValue(undefined);
  mockResetOnboarding.mockResolvedValue(undefined);
});

describe("useOnboarding", () => {
  it("starts in loading state when uid is provided and resolves to shouldShow=true on null state", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(true);
    expect(result.current.currentStep).toBe(0);
  });

  it("does not fetch when uid is null and stays in non-loading + shouldShow=false", async () => {
    const { result } = renderHook(() => useOnboarding(null, TOTAL_STEPS));
    expect(result.current.loading).toBe(false);
    expect(result.current.shouldShow).toBe(false);
    expect(mockGetOnboardingState).not.toHaveBeenCalled();
  });

  it("hides the tour when completedAt is set at the current version", async () => {
    mockGetOnboardingState.mockResolvedValueOnce({
      tutorialVersion: 1,
      completedAt: { toDate: () => new Date() },
      skippedAt: null,
    });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(false);
  });

  it("hides the tour when skippedAt is set at the current version", async () => {
    mockGetOnboardingState.mockResolvedValueOnce({
      tutorialVersion: 1,
      completedAt: null,
      skippedAt: { toDate: () => new Date() },
    });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(false);
  });

  it("re-arms the tour when persisted version is stale (mismatch)", async () => {
    mockGetOnboardingState.mockResolvedValueOnce({
      tutorialVersion: 0,
      completedAt: { toDate: () => new Date() },
      skippedAt: null,
    });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(true);
  });

  it("restores in-progress step from local storage when the tour is still active", async () => {
    mockGetLocalProgress.mockReturnValue({ tutorialVersion: 1, currentStep: 2, seenSteps: [0, 1, 2] });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentStep).toBe(2);
  });

  it("clamps an out-of-range restored step into the legal range", async () => {
    mockGetLocalProgress.mockReturnValue({ tutorialVersion: 1, currentStep: 99, seenSteps: [] });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.currentStep).toBe(TOTAL_STEPS - 1);
  });

  it("falls back to shouldShow=true when getOnboardingState rejects", async () => {
    mockGetOnboardingState.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shouldShow).toBe(true);
    expect(result.current.currentStep).toBe(0);
  });

  it("advance() moves forward and persists, clamping at the final step", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.advance());
    expect(result.current.currentStep).toBe(1);
    expect(mockSetLocalProgress).toHaveBeenLastCalledWith("u1", {
      tutorialVersion: 1,
      currentStep: 1,
      seenSteps: [0, 1],
    });

    // Walk to the end
    act(() => result.current.advance());
    act(() => result.current.advance());
    act(() => result.current.advance());
    expect(result.current.currentStep).toBe(4);
    // Past the end stays clamped
    act(() => result.current.advance());
    expect(result.current.currentStep).toBe(4);
  });

  it("back() moves backward and clamps at zero", async () => {
    mockGetLocalProgress.mockReturnValue({ tutorialVersion: 1, currentStep: 2, seenSteps: [0, 1, 2] });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.currentStep).toBe(2));

    act(() => result.current.back());
    expect(result.current.currentStep).toBe(1);
    act(() => result.current.back());
    act(() => result.current.back());
    expect(result.current.currentStep).toBe(0);
  });

  it("skip() flips shouldShow=false, clears local, and writes server flag", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.skip();
    });

    expect(result.current.shouldShow).toBe(false);
    expect(mockClearLocalProgress).toHaveBeenCalledWith("u1");
    expect(mockMarkOnboardingSkipped).toHaveBeenCalledWith("u1");
  });

  it("complete() flips shouldShow=false, clears local, and writes server flag", async () => {
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.complete();
    });

    expect(result.current.shouldShow).toBe(false);
    expect(mockClearLocalProgress).toHaveBeenCalledWith("u1");
    expect(mockMarkOnboardingCompleted).toHaveBeenCalledWith("u1");
  });

  it("replay() resets persistence and re-arms from step 0", async () => {
    mockGetOnboardingState.mockResolvedValueOnce({
      tutorialVersion: 1,
      completedAt: { toDate: () => new Date() },
      skippedAt: null,
    });
    const { result } = renderHook(() => useOnboarding("u1", TOTAL_STEPS));
    await waitFor(() => expect(result.current.shouldShow).toBe(false));

    await act(async () => {
      await result.current.replay();
    });
    expect(result.current.shouldShow).toBe(true);
    expect(result.current.currentStep).toBe(0);
    expect(mockResetOnboarding).toHaveBeenCalledWith("u1");
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

  it("ignores stale fetch results when uid changes mid-flight", async () => {
    let resolveFirst: ((v: unknown) => void) | null = null;
    mockGetOnboardingState.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolveFirst = res;
        }),
    );
    mockGetOnboardingState.mockResolvedValueOnce(null);

    const { result, rerender } = renderHook(({ uid }: { uid: string }) => useOnboarding(uid, TOTAL_STEPS), {
      initialProps: { uid: "u1" },
    });

    // Switch uid before the first fetch settles.
    rerender({ uid: "u2" });

    // Resolve the stale (u1) fetch with a "completed" state — this MUST be ignored.
    await act(async () => {
      resolveFirst?.({ tutorialVersion: 1, completedAt: { toDate: () => new Date() }, skippedAt: null });
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    // The fresh u2 fetch returns null → tour should be visible despite the stale "done" payload.
    expect(result.current.shouldShow).toBe(true);
  });

  it("ignores stale rejections when uid changes mid-flight", async () => {
    let rejectFirst: ((reason: unknown) => void) | null = null;
    mockGetOnboardingState.mockImplementationOnce(
      () =>
        new Promise((_res, rej) => {
          rejectFirst = rej;
        }),
    );
    // Second mount returns "done" state — this should win over a late stale rejection.
    mockGetOnboardingState.mockResolvedValueOnce({
      tutorialVersion: 1,
      completedAt: { toDate: () => new Date() },
      skippedAt: null,
    });

    const { result, rerender } = renderHook(({ uid }: { uid: string }) => useOnboarding(uid, TOTAL_STEPS), {
      initialProps: { uid: "u1" },
    });

    rerender({ uid: "u2" });

    // Reject the stale (u1) fetch — the .catch branch must early-return on stale.
    await act(async () => {
      rejectFirst?.(new Error("stale-throw"));
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    // Fresh "done" state wins; the stale rejection's setResolved was suppressed.
    expect(result.current.shouldShow).toBe(false);
  });
});
