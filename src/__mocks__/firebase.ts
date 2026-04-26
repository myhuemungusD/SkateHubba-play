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
 *
 * Tests should call resetFirebaseMock() in a beforeEach when they mutate
 * shared state (auth.currentUser, spy call history, isEmulatorMode) so state
 * does not leak across cases.
 */
import { vi } from "vitest";
import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

export const firebaseReady = true;
export const FIRESTORE_DB_NAME = "skatehubba";
export const firestoreCacheMode: "persistent" | "memory" = "persistent";

// `let` so tests can flip emulator behaviour via Object.defineProperty on the
// module namespace (see auth.test.ts). Vite's SSR transform preserves the
// live binding so consumer modules observe the updated value.
export let isEmulatorMode = false;

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

/**
 * Reset every spy and shared mutable export to its post-import default.
 * Safe to call from a `beforeEach` — preserves the default vi.fn implementations
 * so requireDb/requireAuth/requireStorage keep returning their stub instances.
 */
export function resetFirebaseMock(): void {
  requireAuth.mockClear();
  requireDb.mockClear();
  requireStorage.mockClear();
  isAppCheckInitialized.mockClear();
  isAppCheckInitialized.mockImplementation(() => false);
  (auth as unknown as { currentUser: unknown }).currentUser = null;
  isEmulatorMode = false;
}

const app = {} as FirebaseApp;
export default app;
