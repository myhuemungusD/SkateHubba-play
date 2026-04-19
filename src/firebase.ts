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
import { captureMessage } from "./lib/sentry";
import { logger } from "./services/logger";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// NOTE: We intentionally do NOT override authDomain to skatehubba.com here.
// Firebase email-verification and password-reset links point to
// https://{authDomain}/__/auth/action — that handler is served by Firebase
// Hosting on *.firebaseapp.com domains.  Overriding authDomain to a Vercel-
// hosted domain breaks every outbound email link because Vercel does not
// serve the /__/auth/action endpoint.

// True when all required Firebase env vars are present
export const firebaseReady = Boolean(firebaseConfig.apiKey);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

if (firebaseReady) {
  app = initializeApp(firebaseConfig);

  // Firestore — using named "skatehubba" database.
  // In emulator mode use memory cache to avoid IndexedDB/persistence issues
  // that can stall getDoc() in headless Chrome on CI.
  const useEmulators = import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true";
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
  /* v8 ignore start */
  if (import.meta.env.DEV) {
    // Expose debug token so the App Check debug provider works locally.
    // Firebase App Check reads this off the global scope at init time.
    (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  /* v8 ignore stop */
  /* v8 ignore start -- App Check branches depend on runtime env vars not available in tests */
  if (import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(String(import.meta.env.VITE_RECAPTCHA_SITE_KEY)),
      isTokenAutoRefreshEnabled: true,
    });
  } else if (import.meta.env.PROD) {
    // Hard fail in production — silently no-opting App Check leaves the app
    // exposed to bots and abuse traffic with no signal that protection is off.
    // Sentry capture preserves the historical telemetry signal for ops; the
    // throw forces the deploy to surface the misconfiguration immediately.
    logger.error("appcheck_disabled", { hint: "set VITE_RECAPTCHA_SITE_KEY to protect against API abuse" });
    captureMessage("App Check disabled in production — set VITE_RECAPTCHA_SITE_KEY", "error");
    throw new Error(
      "App Check is required in production — set VITE_RECAPTCHA_SITE_KEY (reCAPTCHA v3 site key from Firebase Console → App Check)",
    );
  } else {
    // Dev/emulator without a key: warn but continue so local development isn't blocked.
    logger.warn("appcheck_disabled", { hint: "set VITE_RECAPTCHA_SITE_KEY to protect against API abuse" });
  }
  /* v8 ignore stop */

  // Connect to emulators in development (if running)
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
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
export const isEmulatorMode = Boolean(
  import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true" && firebaseReady,
);

export { db, auth, storage, requireDb, requireAuth, requireStorage };
export default app;
