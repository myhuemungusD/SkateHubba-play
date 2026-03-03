import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  initializeFirestore,
} from "firebase/firestore";
import { getStorage, connectStorageEmulator } from "firebase/storage";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Validate config — detect missing environment variables
if (!firebaseConfig.apiKey) {
  const isVercel = typeof import.meta.env.VERCEL !== "undefined";
  const message = isVercel
    ? "Firebase config missing. Add VITE_FIREBASE_* environment variables in Vercel Dashboard → Project Settings → Environment Variables (scope: Preview and/or Production)."
    : "Firebase config missing. Copy .env.example to .env.local and fill in your Firebase project values.";
  console.error(`⚠️ ${message}`);
}

const app = initializeApp(firebaseConfig);

// Firestore — using default database
export const db = getFirestore(app);

export const auth = getAuth(app);
export const storage = getStorage(app);

// Connect to emulators in development (if running)
if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
  connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "localhost", 8080);
  connectStorageEmulator(storage, "localhost", 9199);
}

export default app;
