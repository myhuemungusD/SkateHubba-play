import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── mock firebase packages ─────────────────── */
// Each impl is variadic so the `(...args: unknown[]) => mock(...args)` factory
// dispatchers below type-check under vitest 4's stricter mock signature.
const mockInitializeApp = vi.fn((..._args: unknown[]) => ({ name: "test-app" }));
const mockGetAuth = vi.fn((..._args: unknown[]) => ({ name: "test-auth" }));
const mockGetStorage = vi.fn((..._args: unknown[]) => ({ name: "test-storage" }));
const mockInitializeFirestore = vi.fn((..._args: unknown[]) => ({ name: "test-db" }));
const mockConnectAuthEmulator = vi.fn();
const mockConnectFirestoreEmulator = vi.fn();
const mockConnectStorageEmulator = vi.fn();
const mockMemoryLocalCache = vi.fn((..._args: unknown[]) => ({ __cache: "memory" }));
const mockPersistentLocalCache = vi.fn((..._args: unknown[]) => ({ __cache: "persistent" }));
const mockPersistentMultipleTabManager = vi.fn((..._args: unknown[]) => ({}));
const mockAddBreadcrumb = vi.fn();

vi.mock("../lib/sentry", () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  captureMessage: vi.fn(),
  captureException: vi.fn(),
  initSentry: vi.fn(),
  setUser: vi.fn(),
}));

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

  it("uses persistent cache and reports firestoreCacheMode='persistent' by default", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.firestoreCacheMode).toBe("persistent");
    expect(mockPersistentLocalCache).toHaveBeenCalledTimes(1);
    expect(mockMemoryLocalCache).not.toHaveBeenCalled();
    expect(mockInitializeFirestore).toHaveBeenCalledTimes(1);
    // No "lifecycle" breadcrumb for cache fallback on the happy path.
    // (logger.info forwards info-level breadcrumbs with category="app"; we
    // only care that no lifecycle/cache-failure crumb was emitted.)
    const lifecycleCrumbs = mockAddBreadcrumb.mock.calls.filter(
      ([arg]) => (arg as { category?: string } | undefined)?.category === "lifecycle",
    );
    expect(lifecycleCrumbs).toHaveLength(0);
  });

  it("falls back to memory cache when persistent cache init throws (Safari private / broken WebView)", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Simulate IndexedDB unavailable — first initializeFirestore call throws
    // synchronously (as persistentLocalCache does in Safari private mode).
    // Fallback call with memoryLocalCache must succeed.
    mockInitializeFirestore
      .mockImplementationOnce(() => {
        throw new Error("IndexedDB is not available");
      })
      .mockImplementationOnce(() => ({ name: "test-db-memory" }));

    const mod = await import("../firebase");

    // Fallback applied
    expect(mod.firestoreCacheMode).toBe("memory");
    expect(mod.db).not.toBeNull();

    // Both variants attempted
    expect(mockInitializeFirestore).toHaveBeenCalledTimes(2);
    expect(mockPersistentLocalCache).toHaveBeenCalledTimes(1);
    expect(mockMemoryLocalCache).toHaveBeenCalledTimes(1);

    // Breadcrumb recorded — failure must never be silently swallowed.
    // Filter by category="lifecycle" + specific message so we're robust to
    // unrelated info-level breadcrumbs emitted by logger.info elsewhere.
    const lifecycleCrumbs = mockAddBreadcrumb.mock.calls.filter(
      ([arg]) =>
        (arg as { category?: string; message?: string } | undefined)?.category === "lifecycle" &&
        (arg as { message?: string } | undefined)?.message === "firestore_persistent_cache_failed",
    );
    expect(lifecycleCrumbs).toHaveLength(1);
    expect(lifecycleCrumbs[0][0]).toEqual(
      expect.objectContaining({
        category: "lifecycle",
        message: "firestore_persistent_cache_failed",
        data: expect.objectContaining({
          error: expect.stringContaining("IndexedDB is not available"),
        }),
      }),
    );
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
