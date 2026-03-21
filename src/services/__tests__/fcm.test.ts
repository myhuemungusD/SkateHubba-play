import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── mock firebase/messaging ─────────────────── */

const mockGetToken = vi.fn();
const mockOnMessage = vi.fn(() => vi.fn());
const mockGetMessaging = vi.fn(() => "messaging-instance");

vi.mock("firebase/messaging", () => ({
  getMessaging: (...args: unknown[]) => mockGetMessaging(...args),
  getToken: (...args: unknown[]) => mockGetToken(...args),
  onMessage: (...args: unknown[]) => mockOnMessage(...args),
}));

/* ── mock firebase/firestore ─────────────────── */

const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn((_db: unknown, ...segments: string[]) => segments.join("/"));
const mockArrayUnion = vi.fn((v: string) => ({ _op: "arrayUnion", value: v }));
const mockArrayRemove = vi.fn((v: string) => ({ _op: "arrayRemove", value: v }));

vi.mock("firebase/firestore", () => ({
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  doc: (...args: unknown[]) => mockDoc(...args),
  arrayUnion: (v: string) => mockArrayUnion(v),
  arrayRemove: (v: string) => mockArrayRemove(v),
}));

vi.mock("../../firebase");

/* ── tests ───────────────────────────────────── */

import { requestPushPermission, removeFcmToken, onForegroundMessage, _resetSwRegistration } from "../fcm";

// jsdom doesn't provide Notification — stub it globally for these tests
const mockRequestPermission = vi.fn<[], Promise<NotificationPermission>>();
const originalNotification = globalThis.Notification;

beforeEach(() => {
  vi.clearAllMocks();
  _resetSwRegistration();
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
    // @ts-expect-error - testing missing API
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

  it("returns token and stores in Firestore on success", async () => {
    mockRequestPermission.mockResolvedValue("granted");
    mockGetToken.mockResolvedValue("fcm-token-123");

    const result = await requestPushPermission("u1");

    expect(result).toBe("fcm-token-123");
    expect(mockGetToken).toHaveBeenCalledWith("messaging-instance", {
      vapidKey: "test-vapid-key",
      serviceWorkerRegistration: expect.any(Object),
    });
    expect(mockUpdateDoc).toHaveBeenCalledWith("users/u1", {
      fcmTokens: { _op: "arrayUnion", value: "fcm-token-123" },
    });
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
});

describe("removeFcmToken", () => {
  it("removes token from Firestore", async () => {
    await removeFcmToken("u1", "token-abc");
    expect(mockUpdateDoc).toHaveBeenCalledWith("users/u1", {
      fcmTokens: { _op: "arrayRemove", value: "token-abc" },
    });
  });

  it("does not throw on error", async () => {
    mockUpdateDoc.mockRejectedValueOnce(new Error("fail"));
    await expect(removeFcmToken("u1", "tok")).resolves.toBeUndefined();
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
