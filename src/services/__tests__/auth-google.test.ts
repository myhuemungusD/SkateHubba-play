import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── hoist mock functions so vi.mock factories can reference them ── */
const { mockSignInWithPopup, mockSignInWithRedirect, mockGetRedirectResult } = vi.hoisted(() => ({
  mockSignInWithPopup: vi.fn(),
  mockSignInWithRedirect: vi.fn(),
  mockGetRedirectResult: vi.fn(),
}));

vi.mock("firebase/auth", () => {
  // GoogleAuthProvider must be a constructable class mock
  class MockGoogleAuthProvider {
    setCustomParameters = vi.fn();
  }
  return {
    GoogleAuthProvider: MockGoogleAuthProvider,
    signInWithPopup: (...args: unknown[]) => mockSignInWithPopup(...args),
    signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
    getRedirectResult: (...args: unknown[]) => mockGetRedirectResult(...args),
    // stub unused imports
    createUserWithEmailAndPassword: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(),
    onAuthStateChanged: vi.fn(),
  };
});

vi.mock("../../firebase");

import { signInWithGoogle, resolveGoogleRedirect } from "../auth";

beforeEach(() => {
  vi.clearAllMocks();
});

/* ── Tests ──────────────────────────────────── */

describe("signInWithGoogle", () => {
  it("returns the user when popup sign-in succeeds", async () => {
    const user = { uid: "u1", email: "sk8r@test.com" };
    mockSignInWithPopup.mockResolvedValueOnce({ user });

    const result = await signInWithGoogle();
    expect(result).toEqual(user);
    expect(mockSignInWithPopup).toHaveBeenCalledTimes(1);
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it("falls back to redirect when popup is blocked and returns null", async () => {
    mockSignInWithPopup.mockRejectedValueOnce({ code: "auth/popup-blocked" });
    mockSignInWithRedirect.mockResolvedValueOnce(undefined);

    const result = await signInWithGoogle();
    expect(result).toBeNull();
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it("falls back to redirect when the environment can't host a popup", async () => {
    // iOS in-app browsers, file:// loads, and some Android WebViews throw
    // this code. The previous narrow "popup-blocked only" check stranded
    // those users with no sign-in path at all.
    mockSignInWithPopup.mockRejectedValueOnce({ code: "auth/operation-not-supported-in-this-environment" });
    mockSignInWithRedirect.mockResolvedValueOnce(undefined);

    const result = await signInWithGoogle();
    expect(result).toBeNull();
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it("falls back to redirect on auth/web-storage-unsupported (Safari private mode)", async () => {
    mockSignInWithPopup.mockRejectedValueOnce({ code: "auth/web-storage-unsupported" });
    mockSignInWithRedirect.mockResolvedValueOnce(undefined);

    const result = await signInWithGoogle();
    expect(result).toBeNull();
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it("rethrows errors that are not popup-blocked", async () => {
    mockSignInWithPopup.mockRejectedValueOnce({
      code: "auth/account-exists-with-different-credential",
    });

    await expect(signInWithGoogle()).rejects.toMatchObject({
      code: "auth/account-exists-with-different-credential",
    });
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it("rethrows popup-closed-by-user instead of forcing a redirect", async () => {
    // Previously this was bundled with popup-blocked as a redirect trigger,
    // which created a loop on mobile Safari: the user closes the popup and
    // still gets kicked to Google's OAuth page. Caller treats this as a
    // silent dismissal.
    mockSignInWithPopup.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" });

    await expect(signInWithGoogle()).rejects.toMatchObject({ code: "auth/popup-closed-by-user" });
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it("rethrows cancelled-popup-request instead of forcing a redirect", async () => {
    mockSignInWithPopup.mockRejectedValueOnce({ code: "auth/cancelled-popup-request" });

    await expect(signInWithGoogle()).rejects.toMatchObject({ code: "auth/cancelled-popup-request" });
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });

  it("rethrows generic errors with no code", async () => {
    const error = new Error("Unknown error");
    mockSignInWithPopup.mockRejectedValueOnce(error);

    await expect(signInWithGoogle()).rejects.toBe(error);
  });
});

describe("resolveGoogleRedirect", () => {
  it("returns the user when a redirect result exists", async () => {
    const user = { uid: "u1" };
    mockGetRedirectResult.mockResolvedValueOnce({ user });

    const result = await resolveGoogleRedirect();
    expect(result).toEqual(user);
  });

  it("returns null when no redirect result is present", async () => {
    mockGetRedirectResult.mockResolvedValueOnce(null);

    const result = await resolveGoogleRedirect();
    expect(result).toBeNull();
  });

  it("returns null on error (safe fallback)", async () => {
    mockGetRedirectResult.mockRejectedValueOnce(new Error("redirect error"));

    const result = await resolveGoogleRedirect();
    expect(result).toBeNull();
  });
});
