import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── mock firebase/messaging ─────────────────── */

// Variadic signatures keep these mocks compatible with vitest 4's stricter
// `vi.fn()` default type while allowing tests to swap return values freely.
const mockGetToken = vi.fn<(...args: unknown[]) => unknown>();
const mockOnMessage = vi.fn<(...args: unknown[]) => unknown>(() => vi.fn());
const mockGetMessaging = vi.fn<(...args: unknown[]) => unknown>(() => "messaging-instance");

vi.mock("firebase/messaging", () => ({
  getMessaging: (...args: unknown[]) => mockGetMessaging(...args),
  getToken: (...args: unknown[]) => mockGetToken(...args),
  onMessage: (...args: unknown[]) => mockOnMessage(...args),
}));

/* ── mock firebase/firestore ─────────────────── */

const mockSetDoc = vi.fn<(...args: unknown[]) => unknown>(() => Promise.resolve(undefined));
const mockDoc = vi.fn<(...args: unknown[]) => unknown>((..._args) => (_args.slice(1) as string[]).join("/"));
const mockArrayUnion = vi.fn((v: string) => ({ _op: "arrayUnion", value: v }));
const mockArrayRemove = vi.fn((v: string) => ({ _op: "arrayRemove", value: v }));

vi.mock("firebase/firestore", () => ({
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  arrayUnion: (v: string) => mockArrayUnion(v),
  arrayRemove: (v: string) => mockArrayRemove(v),
}));

vi.mock("../../firebase");

/* ── tests ───────────────────────────────────── */

import {
  requestPushPermission,
  removeFcmToken,
  removeCurrentFcmToken,
  onForegroundMessage,
  _resetSwRegistration,
  _resetActiveFcmToken,
} from "../fcm";

// jsdom doesn't provide Notification — stub it globally for these tests
const mockRequestPermission = vi.fn<() => Promise<NotificationPermission>>();
const originalNotification = globalThis.Notification;

beforeEach(() => {
  vi.clearAllMocks();
  _resetSwRegistration();
  _resetActiveFcmToken();
  vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "test-vapid-key");

  // Provide a minimal Notification stub
  globalThis.Notification = {
    requestPermission: mockRequestPermission,
    permission: "default",
  } as unknown as typeof Notification;

  // Ensure serviceWorker is present on navigator (jsdom may omit it)
  const mockRegistration = {} as ServiceWorkerRegistration;
  const swStub = { register: vi.fn().mockResolvedValue(mockRegistration) };
  if (!("serviceWorker" in navigator)) {
    Object.defineProperty(navigator, "serviceWorker", { value: swStub, configurable: true });
  } else {
    Object.defineProperty(navigator, "serviceWorker", { value: swStub, configurable: true });
  }
});

afterEach(() => {
  globalThis.Notification = originalNotification;
});

describe("requestPushPermission", () => {
  it("returns null when Notification API is missing", async () => {
    delete (globalThis as Record<string, unknown>).Notification;
    const result = await requestPushPermission("u1");
    expect(result).toBeNull();
  });

  it("returns null when permission is denied", async () => {
    mockRequestPermission.mockResolvedValue("denied");
    const result = await requestPushPermission("u1");
    expect(result).toBeNull();
  });

  it("returns null when VAPID key is not set", async () => {
    vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "");
    mockRequestPermission.mockResolvedValue("granted");
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await requestPushPermission("u1");
    expect(result).toBeNull();
    spy.mockRestore();
  });

  it("returns token and stores in the private profile doc on success", async () => {
    mockRequestPermission.mockResolvedValue("granted");
    mockGetToken.mockResolvedValue("fcm-token-123");

    const result = await requestPushPermission("u1");

    expect(result).toBe("fcm-token-123");
    expect(mockGetToken).toHaveBeenCalledWith("messaging-instance", {
      vapidKey: "test-vapid-key",
      serviceWorkerRegistration: expect.any(Object),
    });
    // fcmTokens live on the owner-only private subcollection doc
    // (users/{uid}/private/profile) rather than the public user doc
    // — prevents cross-user scraping of push-registration tokens.
    expect(mockSetDoc).toHaveBeenCalledWith(
      "users/u1/private/profile",
      { fcmTokens: { _op: "arrayUnion", value: "fcm-token-123" } },
      { merge: true },
    );
  });

  it("returns null when getToken returns empty", async () => {
    mockRequestPermission.mockResolvedValue("granted");
    mockGetToken.mockResolvedValue("");

    const result = await requestPushPermission("u1");
    expect(result).toBeNull();
  });

  it("returns null on error", async () => {
    mockRequestPermission.mockResolvedValue("granted");
    mockGetToken.mockRejectedValue(new Error("network error"));

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await requestPushPermission("u1");
    expect(result).toBeNull();
    spy.mockRestore();
  });

  it("returns null on non-Error throw", async () => {
    mockRequestPermission.mockResolvedValue("granted");
    mockGetToken.mockRejectedValue("string error");

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await requestPushPermission("u1");
    expect(result).toBeNull();
    spy.mockRestore();
  });
});

describe("removeFcmToken", () => {
  it("removes token from the private profile doc", async () => {
    await removeFcmToken("u1", "token-abc");
    expect(mockSetDoc).toHaveBeenCalledWith(
      "users/u1/private/profile",
      { fcmTokens: { _op: "arrayRemove", value: "token-abc" } },
      { merge: true },
    );
  });

  it("does not throw on error", async () => {
    mockSetDoc.mockRejectedValueOnce(new Error("fail"));
    await expect(removeFcmToken("u1", "tok")).resolves.toBeUndefined();
  });
});

describe("removeCurrentFcmToken", () => {
  it("is a no-op when no token has been registered this session", async () => {
    await removeCurrentFcmToken("u1");
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it("removes the token captured by requestPushPermission and clears the cache", async () => {
    // 1. Register a token so the cache is populated.
    mockRequestPermission.mockResolvedValue("granted");
    mockGetToken.mockResolvedValue("device-token-xyz");
    await requestPushPermission("u1");
    // arrayUnion write from requestPushPermission
    expect(mockSetDoc).toHaveBeenCalledTimes(1);

    // 2. Sign-out scrub removes exactly that token on the subcollection.
    await removeCurrentFcmToken("u1");
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
    expect(mockSetDoc).toHaveBeenLastCalledWith(
      "users/u1/private/profile",
      { fcmTokens: { _op: "arrayRemove", value: "device-token-xyz" } },
      { merge: true },
    );

    // 3. Second call is a no-op — cache was cleared by the successful remove.
    await removeCurrentFcmToken("u1");
    expect(mockSetDoc).toHaveBeenCalledTimes(2);
  });

  it("does not throw when the remove write fails", async () => {
    mockRequestPermission.mockResolvedValue("granted");
    mockGetToken.mockResolvedValue("device-token-xyz");
    await requestPushPermission("u1");

    mockSetDoc.mockRejectedValueOnce(new Error("network fail"));
    await expect(removeCurrentFcmToken("u1")).resolves.toBeUndefined();
  });
});

describe("getSwRegistration caching", () => {
  it("returns the same promise on subsequent calls", async () => {
    const { getSwRegistration } = await import("../fcm");
    const first = getSwRegistration();
    const second = getSwRegistration();
    expect(first).toBe(second);
    await first;
  });
});

describe("onForegroundMessage", () => {
  it("registers message listener and returns unsubscribe", () => {
    const cb = vi.fn();
    const unsub = onForegroundMessage(cb);
    expect(mockOnMessage).toHaveBeenCalledWith("messaging-instance", cb);
    expect(typeof unsub).toBe("function");
  });

  it("returns no-op when messaging throws", () => {
    // getMessagingInstance caches, so instead make onMessage throw
    mockOnMessage.mockImplementationOnce(() => {
      throw new Error("messaging unavailable");
    });
    const unsub = onForegroundMessage(vi.fn());
    expect(typeof unsub).toBe("function");
    unsub();
  });
});
