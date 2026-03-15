import { initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, connectAuthEmulator, type Auth } from "firebase/auth";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import {
  getStorage,
  connectStorageEmulator,
  type FirebaseStorage,
} from "firebase/storage";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// True when all required Firebase env vars are present
export const firebaseReady = Boolean(firebaseConfig.apiKey);

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;

if (firebaseReady) {
  app = initializeApp(firebaseConfig);

  // Firestore with offline persistence — using named "skatehubba" database
  db = initializeFirestore(
    app,
    {
      localCache: persistentLocalCache({
        tabManager: persistentMultipleTabManager(),
      }),
    },
    "skatehubba"
  );

  auth = getAuth(app);
  storage = getStorage(app);

  // Firebase App Check — blocks non-app traffic (bots, scrapers, abuse).
  // Requires VITE_RECAPTCHA_SITE_KEY to be set (reCAPTCHA v3 site key from
  // Firebase Console → App Check). In development the debug token is enabled
  // automatically so Firestore still works without a real reCAPTCHA key.
  if (import.meta.env.DEV) {
    // Expose debug token so the App Check debug provider works locally.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).FIREBASE_APPCHECK_DEBUG_TOKEN = true;
  }
  if (import.meta.env.VITE_RECAPTCHA_SITE_KEY) {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(
        import.meta.env.VITE_RECAPTCHA_SITE_KEY as string
      ),
      isTokenAutoRefreshEnabled: true,
    });
  } else if (!import.meta.env.DEV) {
    // Warn in production so the ops team knows App Check is inactive.
    // Not a console.error (would surface in Sentry) — this is an ops notice.
    console.warn("⚠️ App Check is disabled: set VITE_RECAPTCHA_SITE_KEY to protect against API abuse.");
  }

  // Connect to emulators in development (if running)
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
    connectAuthEmulator(auth, "http://localhost:9099", {
      disableWarnings: true,
    });
    connectFirestoreEmulator(db, "localhost", 8080);
    connectStorageEmulator(storage, "localhost", 9199);
  }
} else {
  const isVercel = typeof import.meta.env.VERCEL !== "undefined";
  /* v8 ignore next 4 */
  const message = isVercel
    ? "Firebase config missing. Add VITE_FIREBASE_* environment variables in Vercel Dashboard → Project Settings → Environment Variables (scope: Preview and/or Production)."
    : "Firebase config missing. Copy .env.example to .env.local and fill in your Firebase project values.";
  console.error(`⚠️ ${message}`);
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

export { db, auth, storage, requireDb, requireAuth, requireStorage };
export default app;
