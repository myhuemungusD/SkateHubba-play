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

  it("getPostHogClient returns null before init and the SDK after", async () => {
    const { getPostHogClient, initPosthog } = await import("../posthog");
    expect(getPostHogClient()).toBeNull();
    await initPosthog({ apiKey: "phc_test" });
    expect(getPostHogClient()).toBe(posthogInstance);
  });
});
