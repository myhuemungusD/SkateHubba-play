import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FirebaseApp } from "firebase/app";

const h = vi.hoisted(() => ({
  platform: "ios",
  initialize: vi.fn(async (..._: unknown[]) => undefined),
  setTokenAutoRefreshEnabled: vi.fn(async (..._: unknown[]) => undefined),
  getToken: vi.fn(async (..._: unknown[]): Promise<{ token: string; expireTimeMillis?: number }> => ({
    token: "native-token",
    expireTimeMillis: 123,
  })),
  initializeAppCheck: vi.fn((..._: unknown[]) => ({})),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => h.platform } }));
vi.mock("@capacitor-firebase/app-check", () => ({
  FirebaseAppCheck: {
    initialize: (...a: unknown[]) => h.initialize(...a),
    setTokenAutoRefreshEnabled: (...a: unknown[]) => h.setTokenAutoRefreshEnabled(...a),
    getToken: (...a: unknown[]) => h.getToken(...a),
  },
}));
vi.mock("firebase/app-check", () => ({
  initializeAppCheck: (...a: unknown[]) => h.initializeAppCheck(...a),
  CustomProvider: class {
    constructor(public options: { getToken: () => Promise<{ token: string; expireTimeMillis: number }> }) {}
  },
}));

import { installNativeAppCheck } from "../nativeAppCheck";

const app = { name: "test-app" } as FirebaseApp;

/** The CustomProvider handed to the web SDK, and its getToken bridge. */
function bridged() {
  const [passedApp, options] = h.initializeAppCheck.mock.calls[0] as [
    FirebaseApp,
    { provider: { options: { getToken: () => Promise<unknown> } }; isTokenAutoRefreshEnabled: boolean },
  ];
  return { passedApp, options, getToken: options.provider.options.getToken };
}

describe("installNativeAppCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.platform = "ios";
  });

  it("bridges the native token into the web SDK with a CustomProvider", async () => {
    await installNativeAppCheck(app, false);
    const { passedApp, options, getToken } = bridged();
    expect(passedApp).toBe(app);
    expect(options.isTokenAutoRefreshEnabled).toBe(true);
    await expect(getToken()).resolves.toEqual({ token: "native-token", expireTimeMillis: 123 });
    expect(h.getToken).toHaveBeenCalledWith({ forceRefresh: false });
  });

  it("on iPhone keeps the provider set before configure (no initialize), only auto-refresh", async () => {
    await installNativeAppCheck(app, true);
    expect(h.initialize).not.toHaveBeenCalled();
    expect(h.setTokenAutoRefreshEnabled).toHaveBeenCalledWith({ enabled: true });
  });

  it("on Android initializes Play Integrity (or debug) with auto-refresh", async () => {
    h.platform = "android";
    await installNativeAppCheck(app, true);
    expect(h.initialize).toHaveBeenCalledWith({ debugToken: true, isTokenAutoRefreshEnabled: true });
    expect(h.setTokenAutoRefreshEnabled).not.toHaveBeenCalled();
  });

  it("gives the token a short lifetime when the plugin omits the expiry", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_000);
    h.getToken.mockResolvedValueOnce({ token: "t" });
    await installNativeAppCheck(app, false);
    await expect(bridged().getToken()).resolves.toEqual({ token: "t", expireTimeMillis: 301_000 });
  });

  it("does not install the bridge when the native plugin fails", async () => {
    h.platform = "android";
    h.initialize.mockRejectedValueOnce(new Error("no play services"));
    await expect(installNativeAppCheck(app, false)).rejects.toThrow("no play services");
    expect(h.initializeAppCheck).not.toHaveBeenCalled();
  });
});
