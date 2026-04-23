import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator, type FirebaseStorage } from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";
import { Capacitor } from "@capacitor/core";
import { FirebaseAppCheck } from "@capacitor-firebase/app-check";
import { captureMessage } from "./lib/sentry";
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

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

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
  const useEmulators = import.meta.env.DEV && env.VITE_USE_EMULATORS === true;
  db = initializeFirestore(
    app,
    useEmulators
      ? { localCache: memoryLocalCache(), experimentalForceLongPolling: true }
      : {
          localCache: persistentLocalCache({
            tabManager: persistentMultipleTabManager(),
          }),
        },
    "skatehubba",
  );

  auth = getAuth(app);
  storage = getStorage(app);

  // Firebase App Check — blocks non-app traffic (bots, scrapers, abuse).
  // Requires VITE_RECAPTCHA_SITE_KEY to be set (reCAPTCHA v3 site key from
  // Firebase Console → App Check). In development the debug token is enabled
  // automatically so Firestore still works without a real reCAPTCHA key.
  //
  // ⚠️ OPT-IN DEFAULT ⚠️
  // App Check is OFF by default. Set VITE_APPCHECK_ENABLED=true in Vercel to
  // turn it on. This default exists because a Firebase Console enforcement
  // toggle without a matching reCAPTCHA domain allowlist silently rejects
  // every Firestore read with permission-denied and locks every signed-in
  // user out of the app (this happened in the Apr 22 incident — see
  // docs/PERMISSION_DENIED_RUNBOOK.md). Once the Firebase App Check metrics
  // show a verified-request rate > 95 % for the skatehubba.com + www
  // domains, flip the env var to re-enable.
  /* v8 ignore start */
  if (import.meta.env.DEV) {
    // Expose debug token so the App Check debug provider works locally.
    // Firebase App Check reads this off the global scope at init time.
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  /* v8 ignore stop */
  /* v8 ignore start -- App Check branches depend on runtime env vars not available in tests */
  if (!env.VITE_APPCHECK_ENABLED) {
    // Default path — App Check is not enabled by default. Log once so
    // operators know the opt-in flag is required to turn it back on.
    logger.info("appcheck_skipped_opt_in_required", {
      hint: "set VITE_APPCHECK_ENABLED=true + VITE_RECAPTCHA_SITE_KEY to enable",
    });
  } else if (Capacitor.isNativePlatform()) {
    // ── Native path (iOS / Android via Capacitor) ────────────────────
    // The Firebase JS SDK only ships ReCaptchaV3Provider /
    // ReCaptchaEnterpriseProvider / CustomProvider — none of which work
    // inside a Capacitor WebView. Delegating to @capacitor-firebase/app-check
    // uses the platform-native attestation SDKs (DeviceCheck on iOS,
    // Play Integrity on Android) through the plugin bridge.
    //
    // In emulator / dev builds we request the debug provider so the
    // attestation step doesn't reject a development device. In release
    // builds the plugin auto-selects DeviceCheck (iOS) / Play Integrity
    // (Android) — no provider option is needed on the JS side.
    const useDebug = useEmulators || import.meta.env.DEV;
    FirebaseAppCheck.initialize({
      debug: useDebug,
      siteKey: env.VITE_RECAPTCHA_SITE_KEY,
    }).catch((err: unknown) => {
      logger.error("appcheck_native_init_failed", {
        message: err instanceof Error ? err.message : String(err),
      });
      captureMessage(
        `Native App Check init failed — Auth/Firestore requests may be rejected: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    });
  } else if (env.VITE_RECAPTCHA_SITE_KEY) {
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      // An invalid site key or blocked reCAPTCHA loader throws synchronously here.
      // Without this catch the whole Firebase init module would crash on load,
      // taking the app down — log loudly and let the rest of Firebase continue.
      logger.error("appcheck_init_failed", { message: err instanceof Error ? err.message : String(err) });
      captureMessage(
        `App Check init failed — Auth/Firestore requests may be rejected: ${err instanceof Error ? err.message : String(err)}`,
        "error",
      );
    }
  } else {
    // Operator set VITE_APPCHECK_ENABLED=true but forgot the site key — log
    // loudly in every environment so the misconfiguration surfaces before
    // the first Firestore call silently fails.
    logger.error("appcheck_enabled_but_no_site_key", {
      hint: "VITE_APPCHECK_ENABLED=true requires VITE_RECAPTCHA_SITE_KEY",
    });
    captureMessage("App Check opt-in is set but VITE_RECAPTCHA_SITE_KEY is missing — init skipped", "error");
  }
  /* v8 ignore stop */

  // Connect to emulators in development (if running)
  if (useEmulators) {
    connectAuthEmulator(auth, "http://localhost:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "localhost", 8080);
    connectStorageEmulator(storage, "localhost", 9199);
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
  if (!storage) throw new Error("Firebase not initialized — check VITE_FIREBASE_* env vars");
  return storage;
}

/** True when running against local Firebase emulators */
export const isEmulatorMode = Boolean(import.meta.env.DEV && env?.VITE_USE_EMULATORS === true && firebaseReady);

export { db, auth, storage, requireDb, requireAuth, requireStorage };
export default app;
