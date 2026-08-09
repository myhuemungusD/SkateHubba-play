import { describe, it, expect, vi, beforeEach } from "vitest";

const posthogInstance = {
  init: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
  register: vi.fn(),
};

vi.mock("posthog-js", () => ({
  default: posthogInstance,
}));

describe("posthog wrapper", () => {
  beforeEach(() => {
    vi.resetModules();
    posthogInstance.init.mockReset();
    posthogInstance.capture.mockReset();
    posthogInstance.identify.mockReset();
    posthogInstance.reset.mockReset();
    posthogInstance.register.mockReset();
  });

  it("no-ops every helper before initPosthog resolves", async () => {
    const { captureEvent, identify, resetIdentity } = await import("../posthog");
    // None of these may touch the real SDK until initPosthog loaded it.
    captureEvent("boot_event", { x: 1 });
    identify("u1", { username: "alice" });
    resetIdentity();
    expect(posthogInstance.capture).not.toHaveBeenCalled();
    expect(posthogInstance.identify).not.toHaveBeenCalled();
    expect(posthogInstance.reset).not.toHaveBeenCalled();
  });

  it("initPosthog dynamically loads the SDK and forwards the API key", async () => {
    const { initPosthog } = await import("../posthog");
    await initPosthog({ apiKey: "phc_test", host: "https://eu.i.posthog.com" });
    expect(posthogInstance.init).toHaveBeenCalledTimes(1);
    const [key, config] = posthogInstance.init.mock.calls[0];
    expect(key).toBe("phc_test");
    expect(config).toMatchObject({
      api_host: "https://eu.i.posthog.com",
      autocapture: false,
      capture_pageview: false,
      respect_dnt: true,
      disable_session_recording: true,
      persistence: "localStorage",
    });
  });

  it("initPosthog defaults to the US cloud host when none is supplied", async () => {
    const { initPosthog } = await import("../posthog");
    await initPosthog({ apiKey: "phc_test" });
    const [, config] = posthogInstance.init.mock.calls[0];
    expect(config.api_host).toBe("https://us.i.posthog.com");
  });

  it("registers the release as app_version super-property when provided", async () => {
    const { initPosthog } = await import("../posthog");
    await initPosthog({ apiKey: "phc_test", release: "v1.2.0" });
    expect(posthogInstance.register).toHaveBeenCalledWith({ app_version: "v1.2.0" });
  });

  it("initPosthog is idempotent — second call does not re-init the SDK", async () => {
    const { initPosthog } = await import("../posthog");
    await initPosthog({ apiKey: "phc_test" });
    await initPosthog({ apiKey: "phc_test" });
    expect(posthogInstance.init).toHaveBeenCalledTimes(1);
  });

  it("captureEvent forwards name + properties after init", async () => {
    const { initPosthog, captureEvent } = await import("../posthog");
    await initPosthog({ apiKey: "phc_test" });
    captureEvent("game_created", { gameId: "g1" });
    expect(posthogInstance.capture).toHaveBeenCalledWith("game_created", { gameId: "g1" });
  });

  it("identify forwards the distinct id and properties after init", async () => {
    const { initPosthog, identify } = await import("../posthog");
    await initPosthog({ apiKey: "phc_test" });
    identify("u1", { username: "alice" });
    expect(posthogInstance.identify).toHaveBeenCalledWith("u1", { username: "alice" });
  });

  it("resetIdentity forwards to SDK.reset after init (sign-out path)", async () => {
    const { initPosthog, resetIdentity } = await import("../posthog");
    await initPosthog({ apiKey: "phc_test" });
    resetIdentity();
    expect(posthogInstance.reset).toHaveBeenCalledTimes(1);
  });

  // ── Consent gate ──────────────────────────────────
  //
  // The property under test is that `posthog.init()` itself does not run before
  // consent — not merely that events are suppressed. Init is what mints and
  // persists a `distinct_id` and starts contacting PostHog, so an assertion on
  // `capture` would pass while the real leak continued.

  describe("initPosthogOnConsent", () => {
    const CONSENT_KEY = "sh_analytics_consent";
    const onError = vi.fn();

    beforeEach(() => {
      localStorage.clear();
      onError.mockReset();
    });

    it("does not initialise PostHog while consent is unanswered", async () => {
      const { initPosthogOnConsent } = await import("../posthog");
      initPosthogOnConsent({ apiKey: "phc_test" }, onError);
      // Give any stray microtask a chance to run before asserting absence.
      await Promise.resolve();
      expect(posthogInstance.init).not.toHaveBeenCalled();
    });

    it("does not initialise PostHog when consent is declined", async () => {
      const { initPosthogOnConsent } = await import("../posthog");
      const { writeConsent } = await import("../consent");
      initPosthogOnConsent({ apiKey: "phc_test" }, onError);
      writeConsent("declined");
      await Promise.resolve();
      expect(posthogInstance.init).not.toHaveBeenCalled();
    });

    it("initialises immediately for a returning visitor who already accepted", async () => {
      localStorage.setItem(CONSENT_KEY, "accepted");
      const { initPosthogOnConsent } = await import("../posthog");
      const unsubscribe = initPosthogOnConsent({ apiKey: "phc_test" }, onError);
      await vi.waitFor(() => expect(posthogInstance.init).toHaveBeenCalledTimes(1));
      // Nothing was subscribed on this path, but the caller can't know that —
      // the returned handle must still be safe to call.
      expect(() => unsubscribe()).not.toThrow();
    });

    it("initialises when consent is granted later in the session", async () => {
      const { initPosthogOnConsent } = await import("../posthog");
      const { writeConsent } = await import("../consent");
      initPosthogOnConsent({ apiKey: "phc_test" }, onError);
      expect(posthogInstance.init).not.toHaveBeenCalled();

      writeConsent("accepted");
      await vi.waitFor(() => expect(posthogInstance.init).toHaveBeenCalledTimes(1));
    });

    it("initialises only once when consent flips decline -> accept -> decline -> accept", async () => {
      const { initPosthogOnConsent } = await import("../posthog");
      const { writeConsent } = await import("../consent");
      initPosthogOnConsent({ apiKey: "phc_test" }, onError);

      writeConsent("declined");
      writeConsent("accepted");
      writeConsent("declined");
      writeConsent("accepted");

      await vi.waitFor(() => expect(posthogInstance.init).toHaveBeenCalledTimes(1));
    });

    it("stops listening once unsubscribed, so a later accept does not start it", async () => {
      const { initPosthogOnConsent } = await import("../posthog");
      const { writeConsent } = await import("../consent");
      const unsubscribe = initPosthogOnConsent({ apiKey: "phc_test" }, onError);
      unsubscribe();

      writeConsent("accepted");
      await Promise.resolve();
      expect(posthogInstance.init).not.toHaveBeenCalled();
    });

    it("routes an init failure to the error handler instead of rejecting", async () => {
      localStorage.setItem(CONSENT_KEY, "accepted");
      const boom = new Error("network down");
      posthogInstance.init.mockImplementationOnce(() => {
        throw boom;
      });
      const { initPosthogOnConsent } = await import("../posthog");
      // Must not throw synchronously, and must not produce an unhandled
      // rejection — analytics can never break app boot.
      expect(() => initPosthogOnConsent({ apiKey: "phc_test" }, onError)).not.toThrow();
      await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(boom));
    });
  });
});
