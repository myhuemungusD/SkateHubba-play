/**
 * Tests for auth.ts branches that run when Firebase is not initialized
 * (auth === null). Uses a separate module mock to override the firebase module.
 */
import { describe, it, expect, vi } from "vitest";

const mockGetRedirectResult = vi.fn();

vi.mock("firebase/auth", () => ({
  GoogleAuthProvider: vi.fn().mockImplementation(() => ({ setCustomParameters: vi.fn() })),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: (...args: unknown[]) => mockGetRedirectResult(...args),
  createUserWithEmailAndPassword: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  sendEmailVerification: vi.fn(),
  onAuthStateChanged: vi.fn(),
}));

// Override the firebase module so auth is null
vi.mock("../../firebase", () => ({
  auth: null,
  requireAuth: () => {
    throw new Error("Firebase not initialized — check VITE_FIREBASE_* env vars");
  },
  requireDb: () => {
    throw new Error("Firebase not initialized — check VITE_FIREBASE_* env vars");
  },
  requireStorage: () => {
    throw new Error("Firebase not initialized — check VITE_FIREBASE_* env vars");
  },
  db: null,
  storage: null,
  firebaseReady: false,
}));

import { onAuthChange, resolveGoogleRedirect } from "../auth";

describe("auth service — null Firebase", () => {
  it("onAuthChange immediately calls cb(null) and returns a no-op when auth is null", () => {
    const cb = vi.fn();
    const unsub = onAuthChange(cb);

    expect(cb).toHaveBeenCalledWith(null);
    // Calling the returned unsubscribe should not throw
    expect(() => unsub()).not.toThrow();
  });

  it("resolveGoogleRedirect returns null when auth is null", async () => {
    const result = await resolveGoogleRedirect();
    expect(result).toBeNull();
    expect(mockGetRedirectResult).not.toHaveBeenCalled();
  });
});
