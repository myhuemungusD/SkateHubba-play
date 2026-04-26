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
 * shared state (auth.currentUser, spy call history) so state does not leak
 * across cases.
 */
import { vi } from "vitest";
import type { FirebaseApp } from "firebase/app";
import type { Auth } from "firebase/auth";
import type { Firestore } from "firebase/firestore";
import type { FirebaseStorage } from "firebase/storage";

export const firebaseReady = true;
export const FIRESTORE_DB_NAME = "skatehubba";

// `let` mirrors the real module's `export let` so the binding stays live for
// consumers. Default matches src/firebase.ts at module-init time; the real
// module only flips this to "memory" inside the `if (env)` branch (emulator
// mode or IndexedDB-unavailable fallback), which the mock does not execute.
export let firestoreCacheMode: "persistent" | "memory" = "persistent";

// `let` so tests can flip emulator behaviour via Object.defineProperty on the
// imported module namespace (see auth.test.ts). vi.mock replaces the module
// with this exports object, and consumers' `import { isEmulatorMode }` reads
// resolve to property accesses on it — so namespace overrides are observed.
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
 *
 * Caveat: tests that override an export by replacing its property descriptor
 * (e.g. `Object.defineProperty(mod, "isEmulatorMode", { value: true })`) MUST
 * restore the descriptor in their own `finally`/`afterEach`. A reassignment of
 * the internal `let` binding here does not undo a property-descriptor override
 * on the module namespace.
 */
export function resetFirebaseMock(): void {
  requireAuth.mockClear();
  requireDb.mockClear();
  requireStorage.mockClear();
  isAppCheckInitialized.mockClear();
  isAppCheckInitialized.mockImplementation(() => false);
  (auth as unknown as { currentUser: unknown }).currentUser = null;
  isEmulatorMode = false;
  firestoreCacheMode = "persistent";
}

const app = {} as FirebaseApp;
export default app;
