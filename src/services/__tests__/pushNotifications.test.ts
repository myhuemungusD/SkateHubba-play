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
    register: (...args: unknown[]) => mockRegister(...args),
    unregister: (...args: unknown[]) => mockUnregister(...args),
    addListener: (event: string, cb: unknown) => mockAddListener(event, cb),
    removeAllListeners: (...args: unknown[]) => mockRemoveAllListeners(...args),
  },
}));

/* ── mock firebase/firestore ─────────────────── */

const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn((..._args: unknown[]) => (_args.slice(1) as string[]).join("/"));
const mockArrayUnion = vi.fn((v: string) => ({ _op: "arrayUnion", value: v }));
const mockArrayRemove = vi.fn((v: string) => ({ _op: "arrayRemove", value: v }));

vi.mock("firebase/firestore", () => ({
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  arrayUnion: (v: string) => mockArrayUnion(v),
  arrayRemove: (v: string) => mockArrayRemove(v),
}));

vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
}));

/* ── tests ───────────────────────────────────── */

import {
  isPushSupported,
  requestPushPermission,
  registerPushToken,
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

  it("writes the token into users/{uid}/private/profile on successful registration", async () => {
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

    expect(mockSetDoc).toHaveBeenCalledWith(
      "users/u1/private/profile",
      { fcmTokens: { _op: "arrayUnion", value: "native-token-abc" } },
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
    // No throw bubbled up; the event is still consumed cleanly.
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
    // 1. Register to populate the active-token cache.
    mockRequestPermissions.mockResolvedValue({ receive: "granted" });
    await registerPushToken("u1");
    capturedRegistrationHandler?.({ value: "device-xyz" });
    await flush();
    expect(mockSetDoc).toHaveBeenCalledTimes(1);

    // 2. Sign-out scrub writes arrayRemove for that exact token.
    await unregisterPushToken("u1");
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
    expect(mockSetDoc).toHaveBeenLastCalledWith(
      "users/u1/private/profile",
      { fcmTokens: { _op: "arrayRemove", value: "device-xyz" } },
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
