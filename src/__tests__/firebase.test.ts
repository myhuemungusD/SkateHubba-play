import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── mock firebase packages ─────────────────── */
const mockInitializeApp = vi.fn(() => ({ name: "test-app" }));
const mockGetAuth = vi.fn(() => ({ name: "test-auth" }));
const mockGetStorage = vi.fn(() => ({ name: "test-storage" }));
const mockInitializeFirestore = vi.fn(() => ({ name: "test-db" }));
const mockConnectAuthEmulator = vi.fn();
const mockConnectFirestoreEmulator = vi.fn();
const mockConnectStorageEmulator = vi.fn();
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
  persistentLocalCache: (...args: unknown[]) => mockPersistentLocalCache(...args),
  persistentMultipleTabManager: (...args: unknown[]) => mockPersistentMultipleTabManager(...args),
}));

vi.mock("firebase/storage", () => ({
  getStorage: (...args: unknown[]) => mockGetStorage(...args),
  connectStorageEmulator: (...args: unknown[]) => mockConnectStorageEmulator(...args),
}));

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
    vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.firebaseReady).toBe(true);
    expect(mockInitializeApp).toHaveBeenCalledTimes(1);
    expect(mockInitializeFirestore).toHaveBeenCalledTimes(1);
    expect(mockGetAuth).toHaveBeenCalledTimes(1);
    expect(mockGetStorage).toHaveBeenCalledTimes(1);
  });

  it("connects to emulators when VITE_USE_EMULATORS=true in DEV mode", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
    vi.stubEnv("VITE_USE_EMULATORS", "true");
    // import.meta.env.DEV is true by default in vitest

    await import("../firebase");
    expect(mockConnectAuthEmulator).toHaveBeenCalledTimes(1);
    expect(mockConnectFirestoreEmulator).toHaveBeenCalledTimes(1);
    expect(mockConnectStorageEmulator).toHaveBeenCalledTimes(1);
  });

  it("does not connect to emulators when VITE_USE_EMULATORS is not set", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
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
    vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.requireDb()).toBeDefined();
  });

  it("requireAuth returns the auth instance when initialized", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.requireAuth()).toBeDefined();
  });

  it("requireStorage returns the storage instance when initialized", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.requireStorage()).toBeDefined();
  });
});
