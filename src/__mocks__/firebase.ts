/**
 * Centralized Firebase mock for service-layer tests.
 *
 * Vitest's manual-mock convention: any test that calls bare
 *   vi.mock("../firebase")           // no factory
 * resolves to this file. Tests that pass a factory bypass it entirely
 * (e.g. App.test.tsx, useAuth.test.ts, smoke-*.test.tsx, auth-null-firebase.test.ts).
 *
 * The exported surface MUST mirror src/firebase.ts. Vitest does not type-check
 * that the manual mock matches the real module's exports, so drift is silent
 * until a consumer imports the missing symbol and silently reads undefined.
 */
import { vi } from "vitest";
import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

export const firebaseReady = true;
export const FIRESTORE_DB_NAME = "skatehubba";
export const firestoreCacheMode: "persistent" | "memory" = "persistent";

export const isEmulatorMode = false;

// auth.currentUser is mutated by tests. We keep the public type as `Auth`
// so service-layer code type-checks identically against the real module —
// tests cast through `unknown` when assigning a stand-in user.
export const auth = { currentUser: null } as unknown as Auth;
export const db = {} as Firestore;
export const storage = {} as FirebaseStorage;

export const requireAuth = vi.fn((): Auth => auth);
export const requireDb = vi.fn((): Firestore => db);
export const requireStorage = vi.fn((): FirebaseStorage => storage);

export const isAppCheckInitialized = vi.fn((): boolean => false);

const app = {} as FirebaseApp;
export default app;
