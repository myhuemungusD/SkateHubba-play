import { initializeApp, type FirebaseApp } from "firebase/app";
import { browserLocalPersistence, connectAuthEmulator, getAuth, initializeAuth, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";
import { Capacitor } from "@capacitor/core";
import { addBreadcrumb, captureMessage } from "./lib/sentry";
import { env } from "./lib/env";
import { logger } from "./services/logger";

// NOTE: We intentionally do NOT override authDomain to skatehubba.com here.
// Firebase email-verification and password-reset links point to
// https://{authDomain}/__/auth/action — that handler is served by Firebase
// Hosting on *.firebaseapp.com domains.  Overriding authDomain to a Vercel-
// hosted domain breaks every outbound email link because Vercel does not
// serve the /__/auth/action endpoint.

// True when the Zod-validated env includes every required VITE_FIREBASE_* var.
export const firebaseReady = env !== null;

// Named Firestore database the app talks to. Single source of truth — used
// both by initializeFirestore() below and by diagnostics (e.g. the
// permission-denied breadcrumb in useAuth) so the value reported to Sentry
// always matches the value the SDK actually queried.
export const FIRESTORE_DB_NAME = "skatehubba";

// Flipped to true only after a successful initializeAppCheck() call. Stays
// false on every other path: opt-in skipped, missing site key, init threw.
// Diagnostics read this to disambiguate permission-denied between an App
// Check enforcement mismatch and a genuine rules failure.
let appCheckInitialized = false;
export const isAppCheckInitialized = (): boolean => appCheckInitialized;

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

/** Dev-only. Hoisted so the lazy Storage init can see the same flag. */
const useEmulators = Boolean(import.meta.env.DEV && env?.VITE_USE_EMULATORS === true);

/**
 * Which Firestore local cache strategy we ended up using.
 *
 * IndexedDB-backed `persistentLocalCache` is the preferred path, but it
 * throws synchronously in environments where IndexedDB is unavailable —
 * Safari Private Browsing, some Capacitor in-app WebViews, and very old
 * Android WebViews. When that happens we fall back to `memoryLocalCache`
 * so the module import never crashes the entire app before React mounts.
 *
 * UI can read this flag to decide whether to surface an "offline data
 * unavailable" warning. The flag is set once during module init.
 */
export let firestoreCacheMode: "persistent" | "memory" = "persistent";

if (env) {
  const firebaseConfig = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };

  app = initializeApp(firebaseConfig);

  // Firestore — using named "skatehubba" database.
  // In emulator mode use memory cache to avoid IndexedDB/persistence issues
  // that can stall getDoc() in headless Chrome on CI.
  if (useEmulators) {
    firestoreCacheMode = "memory";
    db = initializeFirestore(app, { localCache: memoryLocalCache(), experimentalForceLongPolling: true }, "skatehubba");
  } else {
    // Try the preferred IndexedDB-backed persistent cache first. It throws
    // synchronously in Safari Private Browsing, some Capacitor WebViews and
    // ancient Android WebViews where IndexedDB is unavailable. Catching that
    // here prevents the whole app from crashing on module load (H-F13) and
    // lets us fall back to an in-memory cache.
    // iOS WKWebView deadlocks inside the persistent IndexedDB cache (the
    // multi-tab lease never settles, and a killed webview leaves the next
    // launch waiting on it). The shell then never gets past the boot
    // spinner. Memory cache cannot hang launch. Offline Firestore data
    // does not survive an iOS restart; Android and the website keep the
    // persistent multi-tab cache.
    if (Capacitor.getPlatform() === "ios") {
      firestoreCacheMode = "memory";
      db = initializeFirestore(app, { localCache: memoryLocalCache() }, FIRESTORE_DB_NAME);
    } else {
      try {
        db = initializeFirestore(
          app,
          {
            localCache: persistentLocalCache({
              tabManager: persistentMultipleTabManager(),
            }),
          },
          FIRESTORE_DB_NAME,
        );
        firestoreCacheMode = "persistent";
      } catch (err) {
        // Never silently swallow — always breadcrumb + log so ops can see
        // the fallback was triggered in the field.
        logger.warn("firestore_persistent_cache_failed", {
          message: err instanceof Error ? err.message : String(err),
        });
        addBreadcrumb({
          category: "lifecycle",
          message: "firestore_persistent_cache_failed",
          data: { error: String(err) },
        });
        db = initializeFirestore(app, { localCache: memoryLocalCache() }, FIRESTORE_DB_NAME);
        firestoreCacheMode = "memory";
      }
    }
  }

  // getAuth() opens IndexedDB. On iOS that open can sit forever (same
  // WKWebView deadlock as the Firestore persistent cache), which keeps the
  // shell on the boot spinner. localStorage persistence starts immediately.
  auth =
    Capacitor.getPlatform() === "ios" ? initializeAuth(app, { persistence: browserLocalPersistence }) : getAuth(app);

  // App Check and Storage stay off the first-paint path. Warmup starts the
  // reCAPTCHA provider on the first tap; ensureAppCheck() is what Firestore,
  // Storage, Functions, and sign-in actually wait on.
  scheduleAppCheckWarmup();

  // Connect to emulators in development (if running). Storage connects
  // inside ensureStorage(), after its chunk loads.
  if (useEmulators) {
    connectAuthEmulator(auth, "http://localhost:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "localhost", 8080);
    // Expose auth for E2E tests to force-refresh the ID token after email
    // verification.  Only set when running against the local emulators so it
    // never leaks to production builds.
    (globalThis as Record<string, unknown>).__e2eFirebaseAuth = auth;
  }
} else {
  const isVercel = typeof import.meta.env.VERCEL !== "undefined";
  /* v8 ignore start */
  const message = isVercel
    ? "Firebase config missing. Add VITE_FIREBASE_* environment variables in Vercel Dashboard → Project Settings → Environment Variables (scope: Preview and/or Production)."
    : "Firebase config missing. Copy .env.example to .env.local and fill in your Firebase project values.";
  logger.error("firebase_config_missing", { message });
  /* v8 ignore stop */
}

function requireDb(): Firestore {
  if (!db) throw new Error("Firebase not initialized — check VITE_FIREBASE_* env vars");
  return db;
}

function requireAuth(): Auth {
  if (!auth) throw new Error("Firebase not initialized — check VITE_FIREBASE_* env vars");
  return auth;
}

function requireStorage(): FirebaseStorage {
  if (!app) throw new Error("Firebase not initialized — check VITE_FIREBASE_* env vars");
  if (!storage) throw new Error("Storage not initialized — call ensureStorage() first");
  return storage;
}

/**
 * Install Firebase App Check before the first Firestore, Storage, Functions,
 * or Auth network call. The reCAPTCHA provider is a dynamic import so it is
 * not on the first-paint graph. Resolves immediately when App Check is off
 * or Firebase itself failed to init — callers still proceed, and
 * `isAppCheckInitialized()` stays false so a later permission-denied can be
 * told apart from a rules failure.
 *
 * The enabled path is ignored by coverage: it depends on VITE_APPCHECK_ENABLED
 * plus a reCAPTCHA site key, same as the previous synchronous init.
 */
let appCheckPromise: Promise<void> | null = null;

export function ensureAppCheck(): Promise<void> {
  if (!env?.VITE_APPCHECK_ENABLED || !app) return Promise.resolve();
  /* v8 ignore start -- App Check branches depend on runtime env vars not available in tests */
  appCheckPromise ??= installAppCheck();
  return appCheckPromise;
  /* v8 ignore stop */
}

/* v8 ignore start -- App Check branches depend on runtime env vars not available in tests */
async function installAppCheck(): Promise<void> {
  if (!env || !app) return;
  if (useEmulators) {
    // Expose debug token so the App Check debug provider works locally.
    // Firebase App Check reads this off the global scope at init time.
    // Gated on useEmulators (not import.meta.env.DEV) so a dev build that
    // points at production Firebase never flips its real reCAPTCHA provider
    // into debug mode — that silently fails every App Check token exchange.
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  if (Capacitor.isNativePlatform()) {
    // Native WebViews cannot run ReCaptchaV3Provider. The Capacitor plugin
    // uses DeviceCheck (iOS) / Play Integrity (Android). Awaited so the
    // provider is installed before the first Firestore/Storage/Functions call.
    const useDebug = useEmulators || import.meta.env.DEV;
    try {
      const { FirebaseAppCheck } = await import("@capacitor-firebase/app-check");
      await FirebaseAppCheck.initialize({
        debug: useDebug,
        siteKey: env.VITE_RECAPTCHA_SITE_KEY,
      });
      appCheckInitialized = true;
      addBreadcrumb({
        category: "lifecycle",
        message: "appcheck_native_initialized",
        data: { debug: useDebug },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("appcheck_native_init_failed", { message });
      addBreadcrumb({
        category: "lifecycle",
        message: "appcheck_native_init_failed",
        data: { error: message },
      });
      captureMessage(`Native App Check init failed — Auth/Firestore requests may be rejected: ${message}`, "error");
    }
    return;
  }
  if (env.VITE_RECAPTCHA_SITE_KEY) {
    try {
      const { initializeAppCheck, ReCaptchaV3Provider } = await import("firebase/app-check");
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
      appCheckInitialized = true;
    } catch (err) {
      logger.error("appcheck_init_failed", { message: err instanceof Error ? err.message : String(err) });
      captureMessage(
        `App Check init failed — Auth/Firestore requests may be rejected: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
    return;
  }
  logger.error("appcheck_enabled_but_no_site_key", {
    hint: "VITE_APPCHECK_ENABLED=true requires VITE_RECAPTCHA_SITE_KEY",
  });
  captureMessage("App Check opt-in is set but VITE_RECAPTCHA_SITE_KEY is missing — init skipped", "error");
  /* v8 ignore stop */
}

/**
 * Start App Check on the first tap or key. An idle timer pulled reCAPTCHA
 * into the Lighthouse trace (third-party cookies + a console 400) and sank
 * Best Practices. Sign-in, Storage, Functions, and the profile read all
 * await `ensureAppCheck()` so a token is attached before those calls even
 * if the visitor never hits this listener. Monitor mode is unchanged.
 */
function scheduleAppCheckWarmup(): void {
  if (!env?.VITE_APPCHECK_ENABLED) {
    logger.info("appcheck_skipped_opt_in_required", {
      hint: "set VITE_APPCHECK_ENABLED=true + VITE_RECAPTCHA_SITE_KEY to enable",
    });
    return;
  }
  /* v8 ignore start -- App Check branches depend on runtime env vars not available in tests */
  let started = false;
  const start = () => {
    if (started) return;
    started = true;
    void ensureAppCheck();
  };
  window.addEventListener("pointerdown", start, { once: true, capture: true });
  window.addEventListener("keydown", start, { once: true, capture: true });
  /* v8 ignore stop */
}

let storagePromise: Promise<FirebaseStorage | null> | null = null;

/** Load the Storage SDK (and App Check) the first time an upload or delete needs it. */
export function ensureStorage(): Promise<FirebaseStorage | null> {
  if (storage) return Promise.resolve(storage);
  if (!app) return Promise.resolve(null);
  storagePromise ??= (async () => {
    await ensureAppCheck();
    const { getStorage, connectStorageEmulator } = await import("firebase/storage");
    const instance = getStorage(app as FirebaseApp);
    if (useEmulators) connectStorageEmulator(instance, "localhost", 9199);
    storage = instance;
    return instance;
  })();
  return storagePromise;
}

/** True when running against local Firebase emulators */
export const isEmulatorMode = Boolean(import.meta.env.DEV && env?.VITE_USE_EMULATORS === true && firebaseReady);

export { db, auth, storage, requireDb, requireAuth, requireStorage };
export default app;
