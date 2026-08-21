import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock @capacitor/core ─────────────────────── */

const { mockIsNativePlatform } = vi.hoisted(() => ({
  mockIsNativePlatform: vi.fn().mockReturnValue(true),
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mockIsNativePlatform(),
  },
}));

/* ── mock @capacitor/push-notifications ──────── */

type RegistrationHandler = (token: { value: string }) => void;
type RegistrationErrorHandler = (err: { error: string }) => void;

const mockRequestPermissions = vi.fn();
const mockCheckPermissions = vi.fn();
const mockRegister = vi.fn();
const mockUnregister = vi.fn();
const mockAddListener = vi.fn();
const mockRemoveAllListeners = vi.fn().mockResolvedValue(undefined);
const mockListenerRemove = vi.fn().mockResolvedValue(undefined);

// Captured listeners so tests can fire the native "registration" event.
let capturedRegistrationHandler: RegistrationHandler | null = null;
let capturedRegistrationErrorHandler: RegistrationErrorHandler | null = null;

vi.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    requestPermissions: (...args: unknown[]) => mockRequestPermissions(...args),
    checkPermissions: (...args: unknown[]) => mockCheckPermissions(...args),
    register: (...args: unknown[]) => mockRegister(...args),
    unregister: (...args: unknown[]) => mockUnregister(...args),
    addListener: (event: string, cb: unknown) => mockAddListener(event, cb),
    removeAllListeners: (...args: unknown[]) => mockRemoveAllListeners(...args),
  },
}));

/* ── mock firebase/firestore ─────────────────── */

import { firestoreNotifMocks } from "../../__tests__/harness/firestoreNotifMock";
const { setDoc: mockSetDoc } = firestoreNotifMocks;

vi.mock(
  "firebase/firestore",
  async () => (await import("../../__tests__/harness/firestoreNotifMock")).notifFirestoreModule,
);

vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
}));

// Settings push preference — gates registration. Mocked so these tests cover
// the native surface; the disabled branch has its own case.
const mockGetPushEnabled = vi.hoisted(() => vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)));
vi.mock("../users", () => ({
  PRIVATE_PROFILE_DOC_ID: "profile",
  getPushEnabled: () => mockGetPushEnabled(),
}));

/* ── tests ───────────────────────────────────── */

import {
  isPushSupported,
  requestPushPermission,
  getNativePushPermission,
  registerPushToken,
  registerPushTokenIfGranted,
  subscribeToNativePushOpens,
  unregisterPushToken,
  _resetActivePushToken,
} from "../pushNotifications";

async function flush(): Promise<void> {
  // Let queued microtasks (the persistToken write fired inside the
  // registration listener) resolve before assertions.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks leaves queued `mockResolvedValueOnce` values in place, so a
  // test that stubs the pref read but never consumes it (assumeEnabled skips
  // the read entirely) would leak `false` into the next test. mockReset
  // restores the vi.fn(impl) default of "enabled".
  mockGetPushEnabled.mockReset();
  _resetActivePushToken();
  mockIsNativePlatform.mockReturnValue(true);
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "demo-skatehubba");
  capturedRegistrationHandler = null;
  capturedRegistrationErrorHandler = null;

  // Default: addListener captures the handler and returns a removable stub.
  mockAddListener.mockImplementation(async (event: string, cb: unknown) => {
    if (event === "registration") {
      capturedRegistrationHandler = cb as RegistrationHandler;
    } else if (event === "registrationError") {
      capturedRegistrationErrorHandler = cb as RegistrationErrorHandler;
    }
    return { remove: mockListenerRemove };
  });
  mockRegister.mockResolvedValue(undefined);
  mockUnregister.mockResolvedValue(undefined);
});

describe("isPushSupported", () => {
  it("returns true on native with a configured FCM project", () => {
    mockIsNativePlatform.mockReturnValue(true);
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "demo-skatehubba");
    expect(isPushSupported()).toBe(true);
  });

  it("returns false on web regardless of FCM config", () => {
    mockIsNativePlatform.mockReturnValue(false);
    expect(isPushSupported()).toBe(false);
  });

  it("returns false when VITE_FIREBASE_PROJECT_ID is empty", () => {
    mockIsNativePlatform.mockReturnValue(true);
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "");
    expect(isPushSupported()).toBe(false);
  });
});

describe("requestPushPermission", () => {
  it("maps granted/denied straight through", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ receive: "granted" });
    await expect(requestPushPermission()).resolves.toBe("granted");

    mockRequestPermissions.mockResolvedValueOnce({ receive: "denied" });
    await expect(requestPushPermission()).resolves.toBe("denied");
  });

  it("collapses prompt-with-rationale into 'prompt' for a tight three-value contract", async () => {
    mockRequestPermissions.mockResolvedValueOnce({ receive: "prompt-with-rationale" });
    await expect(requestPushPermission()).resolves.toBe("prompt");
  });
});

describe("registerPushToken", () => {
  it("no-ops on web without calling the native plugin", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    await registerPushToken("u1");
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("does NOT register when the OS denies permission", async () => {
    mockRequestPermissions.mockResolvedValue({ receive: "denied" });
    await registerPushToken("u1");
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockAddListener).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("writes the token into both private profile and pushTargets mirror on successful registration", async () => {
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });

    await registerPushToken("u1");
    expect(mockRegister).toHaveBeenCalledOnce();
    // Listeners attached BEFORE register so cached tokens don't slip past.
    expect(mockAddListener).toHaveBeenCalledWith("registration", expect.any(Function));
    expect(mockAddListener).toHaveBeenCalledWith("registrationError", expect.any(Function));

    // Simulate the native side firing the registration event.
    expect(capturedRegistrationHandler).not.toBeNull();
    capturedRegistrationHandler?.({ value: "native-token-abc" });
    await flush();

    // Canonical write — owner-only private profile doc.
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      1,
      "users/u1/private/profile",
      { fcmTokens: { _op: "arrayUnion", value: "native-token-abc" } },
      { merge: true },
    );
    // Mirror write — cross-readable pushTargets/{uid} doc that senders embed
    // in /push_dispatch (see src/services/pushDispatch.ts).
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      2,
      "pushTargets/u1",
      { tokens: { _op: "arrayUnion", value: "native-token-abc" }, updatedAt: "SERVER_TS" },
      { merge: true },
    );
  });

  it("tears down listeners if register() throws so retries don't stack handlers", async () => {
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    mockRegister.mockRejectedValueOnce(new Error("register failed"));

    await registerPushToken("u1");
    // Both listeners were attached before register() threw — each must be
    // removed to prevent the next retry from firing persistToken twice.
    expect(mockListenerRemove).toHaveBeenCalledTimes(2);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("swallows listener-remove rejections during register-failure cleanup", async () => {
    // Exercises the `.catch(() => {})` guards on tokenListener?.remove() and
    // errorListener?.remove() — a plugin that can't clean up its own
    // listeners should still let `registerPushToken` resolve without
    // throwing, so account-login is never blocked by a listener leak.
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    mockRegister.mockRejectedValueOnce(new Error("register failed"));
    mockListenerRemove.mockRejectedValue(new Error("remove failed"));

    await expect(registerPushToken("u1")).resolves.toBeUndefined();
    expect(mockListenerRemove).toHaveBeenCalledTimes(2);
  });

  it("swallows permission-request errors without throwing", async () => {
    mockRequestPermissions.mockRejectedValue(new Error("plugin not available"));
    await expect(registerPushToken("u1")).resolves.toBeUndefined();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("swallows firestore write failures so login is never blocked", async () => {
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    mockSetDoc.mockRejectedValueOnce(new Error("permission-denied"));

    await registerPushToken("u1");
    capturedRegistrationHandler?.({ value: "native-token-abc" });
    await flush();
    // No throw bubbled up; the catch block exits before the mirror write,
    // so only the private-profile call landed.
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });

  it("ignores empty tokens emitted by the plugin", async () => {
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    await registerPushToken("u1");
    capturedRegistrationHandler?.({ value: "" });
    await flush();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("logs registrationError without throwing", async () => {
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    await registerPushToken("u1");
    expect(capturedRegistrationErrorHandler).not.toBeNull();
    // No assertion on logger here — this exercises the error-path coverage.
    expect(() => capturedRegistrationErrorHandler?.({ error: "APNS unavailable" })).not.toThrow();
  });

  it("honours the Settings opt-out by default", async () => {
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    mockGetPushEnabled.mockResolvedValueOnce(false);
    await registerPushToken("u1");
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("skips the pref re-read when the caller passes assumeEnabled", async () => {
    // The race this closes: Settings flips the toggle on optimistically and the
    // user taps the CTA before the pref write lands, so the server-side read
    // still says false and the registration silently no-ops right after the
    // user tapped Allow.
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    mockGetPushEnabled.mockResolvedValueOnce(false);

    await registerPushToken("u1", { assumeEnabled: true });

    expect(mockGetPushEnabled).not.toHaveBeenCalled();
    expect(mockRegister).toHaveBeenCalledOnce();
    capturedRegistrationHandler?.({ value: "gesture-token" });
    await flush();
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
  });

  it("still respects a denied OS permission even with assumeEnabled", async () => {
    // assumeEnabled bypasses the APP-level preference, never the OS grant.
    mockRequestPermissions.mockResolvedValue({ receive: "denied" });
    await registerPushToken("u1", { assumeEnabled: true });
    expect(mockRegister).not.toHaveBeenCalled();
  });
});

describe("getNativePushPermission", () => {
  it.each([
    ["granted", "granted"],
    ["denied", "denied"],
    ["prompt", "prompt"],
    ["prompt-with-rationale", "prompt"],
  ])("reports %s as %s without ever prompting", async (receive, expected) => {
    mockCheckPermissions.mockResolvedValueOnce({ receive });
    await expect(getNativePushPermission()).resolves.toBe(expected);
    // The whole point: this is a read. A prompt from a render path is the
    // fastest way to get permanently denied.
    expect(mockRequestPermissions).not.toHaveBeenCalled();
  });

  it("returns prompt on web without touching the plugin", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    await expect(getNativePushPermission()).resolves.toBe("prompt");
    expect(mockCheckPermissions).not.toHaveBeenCalled();
  });

  it("fails soft to prompt when the plugin throws", async () => {
    // Never "granted" on an unknown state — that would hide the opt-in from a
    // user who actually needs it.
    mockCheckPermissions.mockRejectedValueOnce(new Error("plugin missing"));
    await expect(getNativePushPermission()).resolves.toBe("prompt");
  });
});

describe("registerPushTokenIfGranted", () => {
  it("never prompts — no requestPermissions call on any path", async () => {
    // The whole point of the split: this variant runs from the auth lifecycle
    // and must not be able to raise a cold OS dialog.
    mockCheckPermissions.mockResolvedValue({ receive: "prompt" });
    await registerPushTokenIfGranted("u1");
    expect(mockRequestPermissions).not.toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("registers when permission was already granted", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "granted" });
    await registerPushTokenIfGranted("u1");
    expect(mockRegister).toHaveBeenCalledOnce();
    capturedRegistrationHandler?.({ value: "warm-token" });
    await flush();
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
  });

  it("no-ops on web without touching the plugin", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    await registerPushTokenIfGranted("u1");
    expect(mockCheckPermissions).not.toHaveBeenCalled();
  });

  it("swallows a checkPermissions failure", async () => {
    mockCheckPermissions.mockRejectedValueOnce(new Error("plugin missing"));
    await expect(registerPushTokenIfGranted("u1")).resolves.toBeUndefined();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("skips registration entirely when the user disabled push in Settings", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "granted" });
    mockGetPushEnabled.mockResolvedValueOnce(false);
    await registerPushTokenIfGranted("u1");
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe("subscribeToNativePushOpens", () => {
  type ActionHandler = (action: { notification: { data: unknown } }) => void;

  /** Attach the subscription and hand back the captured native handler. */
  async function subscribe(cb: (gameId: string) => void): Promise<{ fire: ActionHandler; unsub: () => void }> {
    let handler: ActionHandler = () => {};
    mockAddListener.mockImplementation(async (event: string, listener: unknown) => {
      if (event === "pushNotificationActionPerformed") handler = listener as ActionHandler;
      return { remove: mockListenerRemove };
    });
    const unsub = subscribeToNativePushOpens(cb);
    await flush();
    return { fire: (action) => handler(action), unsub };
  }

  it("emits the gameId from the push data payload", async () => {
    const onOpen = vi.fn();
    const { fire } = await subscribe(onOpen);
    fire({ notification: { data: { gameId: "g1", type: "your_turn" } } });
    expect(onOpen).toHaveBeenCalledWith("g1");
  });

  it("falls back to parsing click_action for legacy payloads", async () => {
    const onOpen = vi.fn();
    const { fire } = await subscribe(onOpen);
    fire({ notification: { data: { click_action: "/?game=g2&x=1" } } });
    expect(onOpen).toHaveBeenCalledWith("g2");
  });

  it("stays silent for payloads with no game reference", async () => {
    const onOpen = vi.fn();
    const { fire } = await subscribe(onOpen);
    fire({ notification: { data: { click_action: "/settings" } } });
    fire({ notification: { data: { gameId: "" } } });
    fire({ notification: { data: null } });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("removes the listener once, however many times unsubscribe is called", async () => {
    const { unsub } = await subscribe(vi.fn());
    unsub();
    unsub();
    await flush();
    expect(mockListenerRemove).toHaveBeenCalledTimes(1);
  });

  it("returns a no-op unsubscribe on web", () => {
    mockIsNativePlatform.mockReturnValue(false);
    const unsub = subscribeToNativePushOpens(vi.fn());
    unsub();
    expect(mockAddListener).not.toHaveBeenCalled();
  });

  it("survives a plugin that rejects addListener", async () => {
    mockAddListener.mockRejectedValueOnce(new Error("no listener for you"));
    const unsub = subscribeToNativePushOpens(vi.fn());
    await flush();
    expect(() => unsub()).not.toThrow();
    await flush();
    expect(mockListenerRemove).not.toHaveBeenCalled();
  });
});

describe("unregisterPushToken", () => {
  it("no-ops on web", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    await unregisterPushToken("u1");
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockUnregister).not.toHaveBeenCalled();
    expect(mockRemoveAllListeners).not.toHaveBeenCalled();
  });

  it("scrubs only the current device's token and clears the cache", async () => {
    // 1. Register to populate the active-token cache. Each register writes
    //    twice now (private profile + pushTargets mirror).
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    await registerPushToken("u1");
    capturedRegistrationHandler?.({ value: "device-xyz" });
    await flush();
    expect(mockSetDoc).toHaveBeenCalledTimes(2);

    // 2. Sign-out scrub writes arrayRemove on both surfaces. Without the
    //    mirror scrub a revoked token would linger and route pushes to a
    //    signed-out device.
    await unregisterPushToken("u1");
    expect(mockSetDoc).toHaveBeenCalledTimes(4);
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      3,
      "users/u1/private/profile",
      { fcmTokens: { _op: "arrayRemove", value: "device-xyz" } },
      { merge: true },
    );
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      4,
      "pushTargets/u1",
      { tokens: { _op: "arrayRemove", value: "device-xyz" }, updatedAt: "SERVER_TS" },
      { merge: true },
    );
    expect(mockRemoveAllListeners).toHaveBeenCalledOnce();
    expect(mockUnregister).toHaveBeenCalledOnce();

    // 3. Second call is a no-op on the Firestore write (cache cleared) but
    //    still safely unwinds the native plugin.
    mockSetDoc.mockClear();
    await unregisterPushToken("u1");
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("swallows native-unregister errors so account-delete is never blocked", async () => {
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    await registerPushToken("u1");
    capturedRegistrationHandler?.({ value: "device-xyz" });
    await flush();

    mockUnregister.mockRejectedValueOnce(new Error("plugin error"));
    await expect(unregisterPushToken("u1")).resolves.toBeUndefined();
  });

  it("swallows firestore write errors so sign-out is never blocked", async () => {
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    await registerPushToken("u1");
    capturedRegistrationHandler?.({ value: "device-xyz" });
    await flush();

    mockSetDoc.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(unregisterPushToken("u1")).resolves.toBeUndefined();
  });
});
