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

  // Firebase App Check — OPT-IN (default OFF). Set VITE_APPCHECK_ENABLED=true
  // plus a reCAPTCHA v3 site key to enable. See docs/PERMISSION_DENIED_RUNBOOK.md
  // for the re-enable checklist (the Apr 22 incident was a console-enforcement
  // flip without the reCAPTCHA allowlist, which locks every user out).
  /* v8 ignore start -- App Check branches depend on runtime env vars not available in tests */
  if (env.VITE_APPCHECK_ENABLED && env.VITE_RECAPTCHA_SITE_KEY) {
    // Surface the debug-provider token so App Check works against the local
    // emulator — Firebase reads it off globalThis at init time. Only set when
    // App Check actually initializes, so the global namespace stays untouched
    // on the default (disabled) path.
    if (import.meta.env.DEV) {
      (self as unknown as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    try {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(env.VITE_RECAPTCHA_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
    } catch (err) {
      // An invalid site key or blocked reCAPTCHA loader throws synchronously here.
      // Without this catch the whole Firebase init module would crash on load,
      // taking the app down — log loudly and let the rest of Firebase continue.
      const message = err instanceof Error ? err.message : String(err);
      logger.error("appcheck_init_failed", { message });
      captureMessage(`App Check init failed — Auth/Firestore requests may be rejected: ${message}`, "error");
    }
  } else if (env.VITE_APPCHECK_ENABLED) {
    // Operator flipped the opt-in flag but forgot the site key — log loudly
    // so the misconfiguration surfaces before the first Firestore call fails.
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
