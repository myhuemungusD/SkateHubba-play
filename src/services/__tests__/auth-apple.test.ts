import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Sign in with Apple (App Store guideline 4.8). Native exchanges the
 * AuthenticationServices identity token; web uses the same popup-then-redirect
 * fallback as Google. Cancels become auth/popup-closed-by-user so the UI
 * stays quiet.
 */

const {
  mockSignInWithPopup,
  mockSignInWithRedirect,
  mockSignInWithCredential,
  mockIsNativePlatform,
  mockNativeSignInWithApple,
  mockCredential,
  recordedScopes,
} = vi.hoisted(() => ({
  mockSignInWithPopup: vi.fn(),
  mockSignInWithRedirect: vi.fn(),
  mockSignInWithCredential: vi.fn(),
  mockIsNativePlatform: vi.fn(() => false),
  mockNativeSignInWithApple: vi.fn(),
  mockCredential: vi.fn((opts: { idToken: string; rawNonce: string }) => ({
    providerId: "apple.com",
    ...opts,
  })),
  recordedScopes: [] as string[],
}));

vi.mock("firebase/auth", () => {
  class MockOAuthProvider {
    addScope(scope: string): this {
      recordedScopes.push(scope);
      return this;
    }
    credential = mockCredential;
  }
  class MockGoogleAuthProvider {
    setCustomParameters = vi.fn();
    static credential = vi.fn();
  }
  return {
    GoogleAuthProvider: MockGoogleAuthProvider,
    OAuthProvider: MockOAuthProvider,
    signInWithPopup: (...args: unknown[]) => mockSignInWithPopup(...args),
    signInWithRedirect: (...args: unknown[]) => mockSignInWithRedirect(...args),
    signInWithCredential: (...args: unknown[]) => mockSignInWithCredential(...args),
    getRedirectResult: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signInWithEmailAndPassword: vi.fn(),
    signOut: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(),
    onAuthStateChanged: vi.fn(),
  };
});

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mockIsNativePlatform },
}));

vi.mock("@capacitor-firebase/authentication", () => ({
  FirebaseAuthentication: {
    signInWithApple: mockNativeSignInWithApple,
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
  },
}));

vi.mock("../../firebase");

import { signInWithApple } from "../auth";

beforeEach(() => {
  vi.clearAllMocks();
  recordedScopes.length = 0;
  mockIsNativePlatform.mockReturnValue(false);
});

describe("signInWithApple (web)", () => {
  it("signs in with a popup and requests email and name", async () => {
    const user = { uid: "apple-1", email: "a@icloud.com" };
    mockSignInWithPopup.mockResolvedValueOnce({ user });
    await expect(signInWithApple()).resolves.toEqual(user);
    expect(recordedScopes).toEqual(["email", "name"]);
    expect(mockNativeSignInWithApple).not.toHaveBeenCalled();
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
  });

  it("falls back to redirect when the popup is blocked", async () => {
    mockSignInWithPopup.mockRejectedValueOnce({ code: "auth/popup-blocked" });
    await expect(signInWithApple()).resolves.toBeNull();
    expect(mockSignInWithRedirect).toHaveBeenCalledTimes(1);
  });

  it("rethrows a real popup failure", async () => {
    const err = { code: "auth/unauthorized-domain", message: "nope" };
    mockSignInWithPopup.mockRejectedValueOnce(err);
    await expect(signInWithApple()).rejects.toBe(err);
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
  });
});

describe("signInWithApple (native)", () => {
  beforeEach(() => {
    mockIsNativePlatform.mockReturnValue(true);
  });

  it("exchanges the Apple identity token and nonce for a Firebase user", async () => {
    const user = { uid: "native-apple", email: "n@icloud.com" };
    mockNativeSignInWithApple.mockResolvedValueOnce({
      credential: { idToken: "apple-id", nonce: "raw-nonce" },
      user,
    });
    mockSignInWithCredential.mockResolvedValueOnce({ user });

    await expect(signInWithApple()).resolves.toEqual(user);
    expect(mockSignInWithPopup).not.toHaveBeenCalled();
    expect(mockCredential).toHaveBeenCalledWith({ idToken: "apple-id", rawNonce: "raw-nonce" });
    expect(mockSignInWithCredential).toHaveBeenCalledTimes(1);
  });

  it("throws when the plugin omits the id token", async () => {
    mockNativeSignInWithApple.mockResolvedValueOnce({ credential: { nonce: "n" }, user: null });
    await expect(signInWithApple()).rejects.toThrow(/idToken/i);
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
  });

  it("throws when the plugin omits the nonce", async () => {
    mockNativeSignInWithApple.mockResolvedValueOnce({ credential: { idToken: "t" }, user: null });
    await expect(signInWithApple()).rejects.toThrow(/idToken/i);
  });

  it("maps a numeric Apple cancel (1001) onto a silent dismiss", async () => {
    mockNativeSignInWithApple.mockRejectedValueOnce({ code: 1001, message: "The operation couldn’t be completed." });
    await expect(signInWithApple()).rejects.toMatchObject({ code: "auth/popup-closed-by-user" });
  });

  it("maps a string code 1001", async () => {
    mockNativeSignInWithApple.mockRejectedValueOnce({ code: "1001", message: "canceled" });
    await expect(signInWithApple()).rejects.toMatchObject({ code: "auth/popup-closed-by-user" });
  });

  it("maps a Firebase popup dismiss and a message that says cancelled", async () => {
    mockNativeSignInWithApple.mockRejectedValueOnce({ code: "auth/popup-closed-by-user" });
    await expect(signInWithApple()).rejects.toMatchObject({ code: "auth/popup-closed-by-user" });

    mockNativeSignInWithApple.mockRejectedValueOnce({ code: "auth/cancelled-popup-request" });
    await expect(signInWithApple()).rejects.toMatchObject({ code: "auth/popup-closed-by-user" });

    mockNativeSignInWithApple.mockRejectedValueOnce(new Error("AuthorizationError error 1001"));
    await expect(signInWithApple()).rejects.toMatchObject({ code: "auth/popup-closed-by-user" });

    mockNativeSignInWithApple.mockRejectedValueOnce(new Error("User canceled the authorization"));
    await expect(signInWithApple()).rejects.toMatchObject({ code: "auth/popup-closed-by-user" });
  });

  it("rethrows a real native failure", async () => {
    const err = new Error("network down");
    mockNativeSignInWithApple.mockRejectedValueOnce(err);
    await expect(signInWithApple()).rejects.toBe(err);
  });
});
