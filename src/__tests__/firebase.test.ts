import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── mock firebase packages ─────────────────── */
const mockInitializeApp = vi.fn(() => ({ name: "test-app" }));
const mockGetAuth = vi.fn(() => ({ name: "test-auth" }));
const mockGetStorage = vi.fn(() => ({ name: "test-storage" }));
const mockInitializeFirestore = vi.fn(() => ({ name: "test-db" }));
const mockConnectAuthEmulator = vi.fn();
const mockConnectFirestoreEmulator = vi.fn();
const mockConnectStorageEmulator = vi.fn();
const mockMemoryLocalCache = vi.fn(() => ({}));
const mockPersistentLocalCache = vi.fn(() => ({}));
const mockPersistentMultipleTabManager = vi.fn(() => ({}));

vi.mock("firebase/app", () => ({
  initializeApp: (...args: unknown[]) => mockInitializeApp(...args),
}));

vi.mock("firebase/auth", () => ({
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
  connectAuthEmulator: (...args: unknown[]) => mockConnectAuthEmulator(...args),
}));

vi.mock("firebase/firestore", () => ({
  initializeFirestore: (...args: unknown[]) => mockInitializeFirestore(...args),
  connectFirestoreEmulator: (...args: unknown[]) => mockConnectFirestoreEmulator(...args),
  memoryLocalCache: (...args: unknown[]) => mockMemoryLocalCache(...args),
  persistentLocalCache: (...args: unknown[]) => mockPersistentLocalCache(...args),
  persistentMultipleTabManager: (...args: unknown[]) => mockPersistentMultipleTabManager(...args),
}));

vi.mock("firebase/storage", () => ({
  getStorage: (...args: unknown[]) => mockGetStorage(...args),
  connectStorageEmulator: (...args: unknown[]) => mockConnectStorageEmulator(...args),
}));

/** Stub every VITE_FIREBASE_* var required by the Zod env schema. */
function stubFirebaseEnv(): void {
  vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
  vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "test.firebaseapp.com");
  vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "test-project");
  vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", "test.firebasestorage.app");
  vi.stubEnv("VITE_FIREBASE_MESSAGING_SENDER_ID", "1234567890");
  vi.stubEnv("VITE_FIREBASE_APP_ID", "1:1234567890:web:abc");
}

describe("firebase module", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not initialize Firebase when VITE_FIREBASE_API_KEY is missing", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../firebase");
    expect(mod.firebaseReady).toBe(false);
    expect(mod.db).toBeNull();
    expect(mod.auth).toBeNull();
    expect(mod.storage).toBeNull();
    expect(mockInitializeApp).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ERROR]",
      "firebase_config_missing",
      expect.objectContaining({ message: expect.stringContaining("Firebase config missing") }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("initializes Firebase when VITE_FIREBASE_API_KEY is set", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.firebaseReady).toBe(true);
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockInitializeFirestore).toHaveBeenCalledTimes(1);
    expect(mockGetAuth).toHaveBeenCalledTimes(1);
    expect(mockGetStorage).toHaveBeenCalledTimes(1);
  });

  it("connects to emulators when VITE_USE_EMULATORS=true in DEV mode", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "true");
    // import.meta.env.DEV is true by default in vitest

    await import("../firebase");
    expect(mockConnectAuthEmulator).toHaveBeenCalledTimes(1);
    expect(mockConnectFirestoreEmulator).toHaveBeenCalledTimes(1);
    expect(mockConnectStorageEmulator).toHaveBeenCalledTimes(1);
    // In emulator mode, memoryLocalCache is used instead of persistentLocalCache
    expect(mockMemoryLocalCache).toHaveBeenCalledTimes(1);
    expect(mockPersistentLocalCache).not.toHaveBeenCalled();
  });

  it("does not connect to emulators when VITE_USE_EMULATORS is not set", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    await import("../firebase");
    expect(mockConnectAuthEmulator).not.toHaveBeenCalled();
    expect(mockConnectFirestoreEmulator).not.toHaveBeenCalled();
    expect(mockConnectStorageEmulator).not.toHaveBeenCalled();
  });

  it("requireDb throws when db is null", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../firebase");
    expect(() => mod.requireDb()).toThrow("Firebase not initialized");
  });

  it("requireAuth throws when auth is null", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../firebase");
    expect(() => mod.requireAuth()).toThrow("Firebase not initialized");
  });

  it("requireStorage throws when storage is null", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../firebase");
    expect(() => mod.requireStorage()).toThrow("Firebase not initialized");
  });

  it("requireDb returns the db instance when initialized", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.requireDb()).toBeDefined();
  });

  it("requireAuth returns the auth instance when initialized", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.requireAuth()).toBeDefined();
  });

  it("requireStorage returns the storage instance when initialized", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.requireStorage()).toBeDefined();
  });

  it("exposes the named Firestore DB and an App Check init probe", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.FIRESTORE_DB_NAME).toBe("skatehubba");
    // initializeFirestore must be called with the named DB constant so the
    // value reported to Sentry on permission-denied always matches the value
    // the SDK actually queries.
    expect(mockInitializeFirestore).toHaveBeenCalledWith(expect.anything(), expect.anything(), "skatehubba");
    // App Check init is gated on VITE_APPCHECK_ENABLED which is unset in the
    // Vitest env, so the probe must report false on this happy-path init.
    expect(mod.isAppCheckInitialized()).toBe(false);
  });
});
