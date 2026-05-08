import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const mockGetPostHogClient = vi.fn();
vi.mock("../../lib/posthog", () => ({
  getPostHogClient: () => mockGetPostHogClient(),
}));

const mockTrackEvent = vi.fn();
vi.mock("../analytics", () => ({
  analytics: {
    featureFlagEvaluated: (...args: unknown[]) => mockTrackEvent(...args),
  },
}));

import { isFeatureEnabled, useFeatureFlag } from "../featureFlags";
import { CONSENT_KEY } from "../../lib/consent";

interface FakePostHog {
  isFeatureEnabled: ReturnType<typeof vi.fn>;
  onFeatureFlags: ReturnType<typeof vi.fn>;
}

/**
 * Build a fake PostHog client. `args` uses 0-or-1 length so callers can
 * distinguish "no initial value" from "explicit undefined" — JavaScript
 * default parameters fire on both, which would otherwise clobber the
 * "PostHog returns undefined for an unknown flag" code path.
 */
function makePostHog(...args: [] | [boolean | undefined]): FakePostHog & {
  /** Trigger every registered onFeatureFlags callback. */
  fireFlags: () => void;
} {
  const callbacks: Array<() => void> = [];
  let returnValue: boolean | undefined = args.length === 0 ? false : args[0];
  const spy = vi.fn(() => returnValue);
  // Allow tests to override post-construction (used by the multivariate
  // string-coercion test below).
  (spy as unknown as { setReturn: (v: boolean | undefined) => void }).setReturn = (v) => {
    returnValue = v;
  };
  return {
    isFeatureEnabled: spy,
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

describe("featureFlags service", () => {
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
    // Only restore spies (Math.random) — vi.restoreAllMocks would also
    // wipe mockImplementation() on every shared mock, breaking the
    // PostHog factory's per-test return-value setup.
    vi.spyOn(Math, "random").mockRestore();
  });

  describe("isFeatureEnabled", () => {
    it("returns the default when PostHog is not initialised", () => {
      mockGetPostHogClient.mockReturnValue(null);
      expect(isFeatureEnabled("foo", false)).toBe(false);
      expect(isFeatureEnabled("foo", true)).toBe(true);
    });

    it("defaults to false when no defaultValue is supplied", () => {
      mockGetPostHogClient.mockReturnValue(null);
      expect(isFeatureEnabled("foo")).toBe(false);
    });

    it("returns the default when consent has not been granted", () => {
      localStorage.removeItem(CONSENT_KEY);
      const ph = makePostHog(true);
      mockGetPostHogClient.mockReturnValue(ph);
      expect(isFeatureEnabled("foo", false)).toBe(false);
      // Must not even ask PostHog — that would leak a network read
      // before consent was granted.
      expect(ph.isFeatureEnabled).not.toHaveBeenCalled();
    });

    it("returns the default when consent is declined", () => {
      localStorage.setItem(CONSENT_KEY, "declined");
      const ph = makePostHog(true);
      mockGetPostHogClient.mockReturnValue(ph);
      expect(isFeatureEnabled("foo", false)).toBe(false);
      expect(ph.isFeatureEnabled).not.toHaveBeenCalled();
    });

    it("returns the PostHog value when consent + SDK + flag are all present", () => {
      const ph = makePostHog(true);
      mockGetPostHogClient.mockReturnValue(ph);
      expect(isFeatureEnabled("foo", false)).toBe(true);
      expect(ph.isFeatureEnabled).toHaveBeenCalledWith("foo");
    });

    it("returns the default when PostHog reports the flag as undefined", () => {
      const ph = makePostHog(undefined);
      mockGetPostHogClient.mockReturnValue(ph);
      expect(isFeatureEnabled("foo", true)).toBe(true);
    });

    it("coerces truthy non-boolean PostHog responses to boolean", () => {
      const ph = makePostHog();
      // PostHog can return a string variant for multivariate flags; the
      // boolean wrapper coerces anything truthy to `true`.
      (ph.isFeatureEnabled as unknown as { setReturn: (v: unknown) => void }).setReturn("control");
      mockGetPostHogClient.mockReturnValue(ph);
      expect(isFeatureEnabled("foo")).toBe(true);
    });

    it("emits feature_flag_evaluated when the sample roll wins (real flag)", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.001);
      const ph = makePostHog(true);
      mockGetPostHogClient.mockReturnValue(ph);
      isFeatureEnabled("flag.x", false);
      expect(mockTrackEvent).toHaveBeenCalledWith("flag.x", true, false);
    });

    it("emits feature_flag_evaluated with defaultUsed=true when consent denied", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.001);
      localStorage.setItem(CONSENT_KEY, "declined");
      mockGetPostHogClient.mockReturnValue(null);
      isFeatureEnabled("flag.y", true);
      expect(mockTrackEvent).toHaveBeenCalledWith("flag.y", true, true);
    });

    it("emits feature_flag_evaluated with defaultUsed=true when SDK absent", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.001);
      mockGetPostHogClient.mockReturnValue(null);
      isFeatureEnabled("flag.z", false);
      expect(mockTrackEvent).toHaveBeenCalledWith("flag.z", false, true);
    });

    it("emits feature_flag_evaluated with defaultUsed=true when flag is unknown", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.001);
      const ph = makePostHog(undefined);
      mockGetPostHogClient.mockReturnValue(ph);
      isFeatureEnabled("flag.unknown", true);
      expect(mockTrackEvent).toHaveBeenCalledWith("flag.unknown", true, true);
    });

    it("does not emit telemetry when sampling roll loses", () => {
      vi.spyOn(Math, "random").mockReturnValue(0.5);
      const ph = makePostHog(true);
      mockGetPostHogClient.mockReturnValue(ph);
      isFeatureEnabled("flag.silent", false);
      expect(mockTrackEvent).not.toHaveBeenCalled();
    });
  });

  describe("useFeatureFlag", () => {
    it("returns the initial PostHog value", () => {
      const ph = makePostHog(true);
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
      const ph = makePostHog(false);
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
      const ph = makePostHog(true);
      mockGetPostHogClient.mockReturnValue(ph);
      const { result } = renderHook(() => useFeatureFlag("foo", false));
      // Consent denied → default returned even though PostHog says true.
      expect(result.current).toBe(false);

      act(() => {
        // writeConsent would notify; emulate via storage event / setter.
        localStorage.setItem(CONSENT_KEY, "accepted");
        window.dispatchEvent(new StorageEvent("storage", { key: CONSENT_KEY }));
      });
      expect(result.current).toBe(true);
    });

    it("unsubscribes both PostHog and consent listeners on unmount", () => {
      const ph = makePostHog(false);
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
      // Unmount must not throw even though no PostHog unsub was registered.
      expect(() => unmount()).not.toThrow();
    });
  });
});
