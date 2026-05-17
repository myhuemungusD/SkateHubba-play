import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockGetPostHogClient = vi.fn();
vi.mock("../../lib/posthog", () => ({
  getPostHogClient: () => mockGetPostHogClient(),
}));

const mockSubscribeConsent = vi.fn();
vi.mock("../../lib/consent", async () => {
  const actual = await vi.importActual<typeof import("../../lib/consent")>("../../lib/consent");
  return {
    ...actual,
    subscribeConsent: (cb: () => void) => mockSubscribeConsent(cb),
  };
});

const mockTrackEvent = vi.fn();
vi.mock("../analytics", () => ({
  analytics: {
    featureFlagEvaluated: (...args: unknown[]) => mockTrackEvent(...args),
  },
}));

import { isFeatureEnabled, subscribeFeatureFlags, getFeatureFlagSnapshot } from "../featureFlags";
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
function makePostHog(...args: [] | [boolean | undefined]): FakePostHog {
  let returnValue: boolean | undefined = args.length === 0 ? false : args[0];
  const spy = vi.fn(() => returnValue);
  // Allow tests to override post-construction (used by the multivariate
  // string-coercion test below).
  (spy as unknown as { setReturn: (v: boolean | undefined) => void }).setReturn = (v) => {
    returnValue = v;
  };
  return {
    isFeatureEnabled: spy,
    onFeatureFlags: vi.fn(),
  };
}

describe("featureFlags service", () => {
  beforeEach(() => {
    mockGetPostHogClient.mockReset();
    mockTrackEvent.mockReset();
    mockSubscribeConsent.mockReset();
    mockSubscribeConsent.mockImplementation(() => () => {});
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

  describe("getFeatureFlagSnapshot", () => {
    it("delegates to isFeatureEnabled", () => {
      const ph = makePostHog(true);
      mockGetPostHogClient.mockReturnValue(ph);
      expect(getFeatureFlagSnapshot("foo", false)).toBe(true);
    });

    it("respects the default when SDK is missing", () => {
      mockGetPostHogClient.mockReturnValue(null);
      expect(getFeatureFlagSnapshot("foo", true)).toBe(true);
    });
  });

  describe("subscribeFeatureFlags", () => {
    it("wires both PostHog and consent subscriptions and tears both down on unsubscribe", () => {
      const phUnsub = vi.fn();
      const consentUnsub = vi.fn();
      const ph = makePostHog(false);
      ph.onFeatureFlags.mockReturnValue(phUnsub);
      mockGetPostHogClient.mockReturnValue(ph);
      mockSubscribeConsent.mockImplementation(() => consentUnsub);

      const notify = vi.fn();
      const unsub = subscribeFeatureFlags(notify);

      expect(ph.onFeatureFlags).toHaveBeenCalledWith(notify);
      expect(mockSubscribeConsent).toHaveBeenCalledWith(notify);
      unsub();
      expect(phUnsub).toHaveBeenCalled();
      expect(consentUnsub).toHaveBeenCalled();
    });

    it("still subscribes to consent when PostHog is absent at subscribe time", () => {
      mockGetPostHogClient.mockReturnValue(null);
      const consentUnsub = vi.fn();
      mockSubscribeConsent.mockImplementation(() => consentUnsub);

      const notify = vi.fn();
      const unsub = subscribeFeatureFlags(notify);

      expect(mockSubscribeConsent).toHaveBeenCalledWith(notify);
      expect(() => unsub()).not.toThrow();
      expect(consentUnsub).toHaveBeenCalled();
    });
  });
});
