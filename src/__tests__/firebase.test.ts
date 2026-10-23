import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ── mock firebase packages ─────────────────── */
// Each mock is typed variadic so the (...args) => mock(...args) dispatcher
// pattern below type-checks under vitest 4's stricter `vi.fn()` signature.
const mockInitializeApp = vi.fn((..._: unknown[]) => ({ name: "test-app" }));
const mockGetAuth = vi.fn((..._: unknown[]) => ({ name: "test-auth" }));
const mockInitializeAuth = vi.fn((..._: unknown[]) => ({ name: "test-auth-local" }));
const mockBrowserLocalPersistence = { kind: "browser-local" };
const mockGetStorage = vi.fn((..._: unknown[]) => ({ name: "test-storage" }));
const mockInitializeFirestore = vi.fn((..._: unknown[]) => ({ name: "test-db" }));
const mockConnectAuthEmulator = vi.fn((..._: unknown[]) => undefined);
const mockConnectFirestoreEmulator = vi.fn((..._: unknown[]) => undefined);
const mockConnectStorageEmulator = vi.fn((..._: unknown[]) => undefined);
const mockMemoryLocalCache = vi.fn((..._: unknown[]) => ({ __cache: "memory" }));
const mockPersistentLocalCache = vi.fn((..._: unknown[]) => ({ __cache: "persistent" }));
const mockPersistentMultipleTabManager = vi.fn((..._: unknown[]) => ({}));
const mockAddBreadcrumb = vi.fn((..._: unknown[]) => undefined);
const mockCaptureMessage = vi.fn((..._: unknown[]) => undefined);
const mockInitializeAppCheck = vi.fn((..._: unknown[]) => ({ name: "test-appcheck" }));
const mockInstallNativeAppCheck = vi.fn(async (..._: unknown[]) => undefined);

const capacitorState = vi.hoisted(() => ({ platform: "web" }));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => capacitorState.platform !== "web",
    getPlatform: () => capacitorState.platform,
  },
}));

vi.mock("../lib/sentry", () => ({
  addBreadcrumb: (...args: unknown[]) => mockAddBreadcrumb(...args),
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  captureException: vi.fn(),
  initSentry: vi.fn(),
  setUser: vi.fn(),
}));

vi.mock("firebase/app", () => ({
  initializeApp: (...args: unknown[]) => mockInitializeApp(...args),
}));

vi.mock("firebase/auth", () => ({
  getAuth: (...args: unknown[]) => mockGetAuth(...args),
  initializeAuth: (...args: unknown[]) => mockInitializeAuth(...args),
  browserLocalPersistence: mockBrowserLocalPersistence,
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

vi.mock("firebase/app-check", () => ({
  initializeAppCheck: (...args: unknown[]) => mockInitializeAppCheck(...args),
  ReCaptchaV3Provider: class {
    constructor(readonly siteKey: string) {}
  },
}));

vi.mock("../lib/nativeAppCheck", () => ({
  installNativeAppCheck: (...args: unknown[]) => mockInstallNativeAppCheck(...args),
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
    capacitorState.platform = "web";
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
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
    // Off Vercel, vite.config defines VERCEL as "": point at .env.local, not the dashboard.
    expect(consoleErrorSpy).toHaveBeenCalledWith("[ERROR]", "firebase_config_missing", {
      message: expect.stringContaining("Copy .env.example to .env.local"),
    });

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
    // Storage is loaded on the first upload/delete, not at module init.
    expect(mockGetStorage).not.toHaveBeenCalled();
    expect(mod.storage).toBeNull();
  });

  it("connects to emulators when VITE_USE_EMULATORS=true in DEV mode", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "true");
    // import.meta.env.DEV is true by default in vitest

    const mod = await import("../firebase");
    expect(mockConnectAuthEmulator).toHaveBeenCalledTimes(1);
    expect(mockConnectFirestoreEmulator).toHaveBeenCalledTimes(1);
    expect(mockConnectStorageEmulator).not.toHaveBeenCalled();
    await mod.ensureStorage();
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
    expect(() => mod.requireStorage()).toThrow("call ensureStorage() first");
    const instance = await mod.ensureStorage();
    expect(instance).toBeDefined();
    expect(mod.requireStorage()).toBe(instance);
    expect(mockGetStorage).toHaveBeenCalledTimes(1);
    await mod.ensureStorage();
    expect(mockGetStorage).toHaveBeenCalledTimes(1);
    expect(mod.isAppCheckInitialized()).toBe(false);
  });

  it("ensureAppCheck resolves without initializing when the flag is unset", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    await mod.ensureAppCheck();
    expect(mod.isAppCheckInitialized()).toBe(false);
  });

  it("ensureStorage resolves null when Firebase never initialized", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    vi.spyOn(console, "error").mockImplementation(() => {});

    const mod = await import("../firebase");
    await expect(mod.ensureStorage()).resolves.toBeNull();
    await expect(mod.ensureAppCheck()).resolves.toBeUndefined();
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

  it("uses the in-memory Firestore cache on the iOS shell", async () => {
    capacitorState.platform = "ios";
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    const mod = await import("../firebase");
    expect(mod.firestoreCacheMode).toBe("memory");
    expect(mockMemoryLocalCache).toHaveBeenCalledTimes(1);
    expect(mockPersistentLocalCache).not.toHaveBeenCalled();
    expect(mockPersistentMultipleTabManager).not.toHaveBeenCalled();
    expect(mockInitializeAuth).toHaveBeenCalledWith(expect.anything(), {
      persistence: mockBrowserLocalPersistence,
    });
    expect(mockGetAuth).not.toHaveBeenCalled();
  });

  it("keeps the multi-tab persistent cache on Android", async () => {
    capacitorState.platform = "android";
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");

    await import("../firebase");
    expect(mockPersistentMultipleTabManager).toHaveBeenCalledTimes(1);
    expect(mockPersistentLocalCache).toHaveBeenCalledWith({
      tabManager: mockPersistentMultipleTabManager.mock.results[0]?.value,
    });
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

  it("names the Vercel dashboard in the missing-config error when built on Vercel", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    vi.stubEnv("VERCEL", "1");
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await import("../firebase");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ERROR]",
      "firebase_config_missing",
      expect.objectContaining({ message: expect.stringContaining("Vercel Dashboard") }),
    );
  });

  it("logs a non-Error persistent-cache failure as a string before falling back", async () => {
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockInitializeFirestore.mockImplementationOnce(() => {
      throw "quota exceeded";
    });

    const mod = await import("../firebase");
    expect(mod.firestoreCacheMode).toBe("memory");
    expect(warnSpy).toHaveBeenCalledWith("[WARN]", "firestore_persistent_cache_failed", {
      message: "quota exceeded",
    });
  });
});

describe("firebase App Check (VITE_APPCHECK_ENABLED=true)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    capacitorState.platform = "web";
    stubFirebaseEnv();
    vi.stubEnv("VITE_USE_EMULATORS", "false");
    vi.stubEnv("VITE_APPCHECK_ENABLED", "true");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    delete (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN;
  });

  it("installs the reCAPTCHA v3 provider once, however many callers wait on it", async () => {
    vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "site-key-123");

    const mod = await import("../firebase");
    expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    await Promise.all([mod.ensureAppCheck(), mod.ensureAppCheck()]);
    await mod.ensureStorage();

    expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
    expect(mockInitializeAppCheck).toHaveBeenCalledWith(
      { name: "test-app" },
      { provider: expect.objectContaining({ siteKey: "site-key-123" }), isTokenAutoRefreshEnabled: true },
    );
    expect(mod.isAppCheckInitialized()).toBe(true);
    expect(mockInstallNativeAppCheck).not.toHaveBeenCalled();
  });

  it.each([
    ["an Error", new Error("recaptcha blocked"), "recaptcha blocked"],
    ["a non-Error value", "boom", "boom"],
  ])("reports %s thrown by initializeAppCheck and leaves the probe false", async (_label, thrown, text) => {
    vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "site-key-123");
    mockInitializeAppCheck.mockImplementationOnce(() => {
      throw thrown;
    });

    const mod = await import("../firebase");
    await mod.ensureAppCheck();

    expect(mod.isAppCheckInitialized()).toBe(false);
    expect(console.error).toHaveBeenCalledWith("[ERROR]", "appcheck_init_failed", { message: text });
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      `App Check init failed — Auth/Firestore requests may be rejected: ${text}`,
      "error",
    );
  });

  it("skips init and raises an error when the opt-in is set without a site key", async () => {
    vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "");

    const mod = await import("../firebase");
    await mod.ensureAppCheck();

    expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    expect(mod.isAppCheckInitialized()).toBe(false);
    expect(console.error).toHaveBeenCalledWith("[ERROR]", "appcheck_enabled_but_no_site_key", {
      hint: "VITE_APPCHECK_ENABLED=true requires VITE_RECAPTCHA_SITE_KEY",
    });
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "App Check opt-in is set but VITE_RECAPTCHA_SITE_KEY is missing — init skipped",
      "error",
    );
  });

  it("bridges the native plugin on the iOS/Android shell instead of reCAPTCHA", async () => {
    capacitorState.platform = "ios";
    vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "site-key-123");

    const mod = await import("../firebase");
    await mod.ensureAppCheck();

    // import.meta.env.DEV is true under Vitest, so the native debug provider is requested.
    expect(mockInstallNativeAppCheck).toHaveBeenCalledWith({ name: "test-app" }, true);
    expect(mockInitializeAppCheck).not.toHaveBeenCalled();
    expect(mod.isAppCheckInitialized()).toBe(true);
    expect(mockAddBreadcrumb).toHaveBeenCalledWith({
      category: "lifecycle",
      message: "appcheck_native_initialized",
      data: { debug: true },
    });
  });

  it.each([
    ["an Error", new Error("attest unavailable"), "attest unavailable"],
    ["a non-Error value", 42, "42"],
  ])("reports %s from the native bridge without throwing to callers", async (_label, thrown, text) => {
    capacitorState.platform = "android";
    mockInstallNativeAppCheck.mockRejectedValueOnce(thrown);

    const mod = await import("../firebase");
    await expect(mod.ensureAppCheck()).resolves.toBeUndefined();

    expect(mod.isAppCheckInitialized()).toBe(false);
    expect(console.error).toHaveBeenCalledWith("[ERROR]", "appcheck_native_init_failed", { message: text });
    expect(mockAddBreadcrumb).toHaveBeenCalledWith({
      category: "lifecycle",
      message: "appcheck_native_init_failed",
      data: { error: text },
    });
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      `Native App Check init failed — Auth/Firestore requests may be rejected: ${text}`,
      "error",
    );
  });

  it("sets the debug token only when talking to the local emulators", async () => {
    vi.stubEnv("VITE_USE_EMULATORS", "true");
    vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "site-key-123");

    const mod = await import("../firebase");
    expect((self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
    await mod.ensureAppCheck();
    expect((self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN).toBe(true);
  });

  it("does not set the debug token against production Firebase", async () => {
    vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "site-key-123");

    const mod = await import("../firebase");
    await mod.ensureAppCheck();
    expect((self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });

  it("starts App Check on the first tap or key, once, and not before", async () => {
    vi.stubEnv("VITE_RECAPTCHA_SITE_KEY", "site-key-123");
    const addSpy = vi.spyOn(window, "addEventListener");

    const mod = await import("../firebase");
    const warmups = addSpy.mock.calls.filter(([type]) => type === "pointerdown" || type === "keydown");
    expect(warmups.map(([type, , opts]) => [type, opts])).toEqual([
      ["pointerdown", { once: true, capture: true }],
      ["keydown", { once: true, capture: true }],
    ]);
    expect(mockInitializeAppCheck).not.toHaveBeenCalled();

    // Both listeners share one start(); a key after the tap must not install
    // twice. ensureAppCheck()'s memo is what guarantees that.
    const start = warmups[0][1] as () => void;
    expect(warmups[1][1]).toBe(start);
    start();
    start();
    await mod.ensureAppCheck();
    expect(mockInitializeAppCheck).toHaveBeenCalledTimes(1);
    expect(mod.isAppCheckInitialized()).toBe(true);
  });
});
