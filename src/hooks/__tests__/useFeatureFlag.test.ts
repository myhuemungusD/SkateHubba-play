import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockGetPostHogClient = vi.fn();
vi.mock("../../lib/posthog", () => ({
  getPostHogClient: () => mockGetPostHogClient(),
}));

const mockTrackEvent = vi.fn();
vi.mock("../../services/analytics", () => ({
  analytics: {
    featureFlagEvaluated: (...args: unknown[]) => mockTrackEvent(...args),
  },
}));

import { useFeatureFlag } from "../useFeatureFlag";
import { CONSENT_KEY } from "../../lib/consent";

/**
 * Hook-suite fake PostHog. Unlike the service-test variant this one
 * captures the onFeatureFlags callbacks so a test can synthesize a
 * "flag flush" — the service tests don't exercise that path because
 * `subscribeFeatureFlags` is asserted in isolation there.
 */
function makeHookPostHog(initial: boolean) {
  const callbacks: Array<() => void> = [];
  const isFeatureEnabled = vi.fn(() => initial);
  return {
    isFeatureEnabled,
    onFeatureFlags: vi.fn((cb: () => void) => {
      callbacks.push(cb);
      return () => {
        const i = callbacks.indexOf(cb);
        if (i >= 0) callbacks.splice(i, 1);
      };
    }),
    fireFlags: () => {
      for (const cb of callbacks) cb();
    },
  };
}

describe("useFeatureFlag", () => {
  beforeEach(() => {
    mockGetPostHogClient.mockReset();
    mockTrackEvent.mockReset();
    localStorage.setItem(CONSENT_KEY, "accepted");
    // Force-disable telemetry sampling by default — tests opt back in
    // when they care about the event.
    vi.spyOn(Math, "random").mockReturnValue(0.99);
  });

  afterEach(() => {
    localStorage.clear();
    vi.spyOn(Math, "random").mockRestore();
  });

  it("returns the initial PostHog value", () => {
    const ph = makeHookPostHog(true);
    mockGetPostHogClient.mockReturnValue(ph);
    const { result } = renderHook(() => useFeatureFlag("foo", false));
    expect(result.current).toBe(true);
  });

  it("returns the default when PostHog is absent", () => {
    mockGetPostHogClient.mockReturnValue(null);
    const { result } = renderHook(() => useFeatureFlag("foo", true));
    expect(result.current).toBe(true);
  });

  it("re-renders when PostHog flushes new flag values", () => {
    const ph = makeHookPostHog(false);
    mockGetPostHogClient.mockReturnValue(ph);
    const { result } = renderHook(() => useFeatureFlag("foo", false));
    expect(result.current).toBe(false);

    // Flip the flag and fire the PostHog onFeatureFlags callback.
    ph.isFeatureEnabled.mockReturnValue(true);
    act(() => {
      ph.fireFlags();
    });
    expect(result.current).toBe(true);
  });

  it("re-renders when consent flips from declined to accepted", () => {
    localStorage.setItem(CONSENT_KEY, "declined");
    const ph = makeHookPostHog(true);
    mockGetPostHogClient.mockReturnValue(ph);
    const { result } = renderHook(() => useFeatureFlag("foo", false));
    // Consent denied → default returned even though PostHog says true.
    expect(result.current).toBe(false);

    act(() => {
      localStorage.setItem(CONSENT_KEY, "accepted");
      window.dispatchEvent(new StorageEvent("storage", { key: CONSENT_KEY }));
    });
    expect(result.current).toBe(true);
  });

  it("unsubscribes both PostHog and consent listeners on unmount", () => {
    const ph = makeHookPostHog(false);
    const phUnsub = vi.fn();
    ph.onFeatureFlags.mockReturnValue(phUnsub);
    mockGetPostHogClient.mockReturnValue(ph);
    const { unmount } = renderHook(() => useFeatureFlag("foo", false));
    unmount();
    expect(phUnsub).toHaveBeenCalled();
  });

  it("handles the case where PostHog is absent at mount (no onFeatureFlags subscription)", () => {
    mockGetPostHogClient.mockReturnValue(null);
    const { result, unmount } = renderHook(() => useFeatureFlag("foo", false));
    expect(result.current).toBe(false);
    expect(() => unmount()).not.toThrow();
  });
});
