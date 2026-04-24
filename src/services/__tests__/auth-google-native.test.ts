import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Native-path coverage for `signInWithGoogle`.
 *
 * When `Capacitor.isNativePlatform()` returns true (iOS / Android shell) the
 * service must delegate to `@capacitor-firebase/authentication`, extract the
 * Google id token from the plugin response, and hand it to
 * `signInWithCredential` — never `signInWithPopup`, which throws inside a
 * Capacitor WebView and is the bug these tests pin down.
 */

const {
  mockSignInWithPopup,
  mockSignInWithRedirect,
  mockSignInWithCredential,
  mockIsNativePlatform,
  mockNativeSignInWithGoogle,
  mockGoogleCredentialFactory,
} = vi.hoisted(() => ({
  mockSignInWithPopup: vi.fn(),
  mockSignInWithRedirect: vi.fn(),
  mockSignInWithCredential: vi.fn(),
  mockIsNativePlatform: vi.fn(() => true),
  mockNativeSignInWithGoogle: vi.fn(),
  mockGoogleCredentialFactory: vi.fn((idToken?: string, accessToken?: string) => ({
    providerId: "google.com",
    signInMethod: "google.com",
    idToken,
    accessToken,
  })),
}));

vi.mock("firebase/auth", () => {
  class MockGoogleAuthProvider {
    setCustomParameters = vi.fn();
    static credential = mockGoogleCredentialFactory;
  }
  return {
    GoogleAuthProvider: MockGoogleAuthProvider,
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
    signInWithGoogle: mockNativeSignInWithGoogle,
  },
}));

vi.mock("../../firebase");

import { signInWithGoogle } from "../auth";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(true);
});

describe("signInWithGoogle (native)", () => {
  it("delegates to FirebaseAuthentication.signInWithGoogle on Capacitor native platforms", async () => {
    const idToken = "id-token-abc";
    const accessToken = "access-token-xyz";
    const user = { uid: "native-uid", email: "native@test.com" };
    mockNativeSignInWithGoogle.mockResolvedValueOnce({
      credential: { idToken, accessToken },
      user,
    });
    mockSignInWithCredential.mockResolvedValueOnce({ user });

    const result = await signInWithGoogle();

    expect(result).toEqual(user);
    // Native plugin is called, the web popup is NOT.
    expect(mockNativeSignInWithGoogle).toHaveBeenCalledTimes(1);
    expect(mockSignInWithPopup).not.toHaveBeenCalled();
    expect(mockSignInWithRedirect).not.toHaveBeenCalled();
    // GoogleAuthProvider.credential is built from the tokens the plugin returns.
    expect(mockGoogleCredentialFactory).toHaveBeenCalledWith(idToken, accessToken);
    // And that credential is exchanged via signInWithCredential.
    expect(mockSignInWithCredential).toHaveBeenCalledTimes(1);
    const [, credArg] = mockSignInWithCredential.mock.calls[0] as [unknown, { idToken?: string }];
    expect(credArg.idToken).toBe(idToken);
  });

  it("works when the native plugin omits the optional accessToken", async () => {
    const idToken = "only-id-token";
    const user = { uid: "u2", email: "b@test.com" };
    mockNativeSignInWithGoogle.mockResolvedValueOnce({
      credential: { idToken },
      user,
    });
    mockSignInWithCredential.mockResolvedValueOnce({ user });

    const result = await signInWithGoogle();

    expect(result).toEqual(user);
    expect(mockGoogleCredentialFactory).toHaveBeenCalledWith(idToken, undefined);
    expect(mockSignInWithCredential).toHaveBeenCalledTimes(1);
  });

  it("throws when the plugin returns no credential", async () => {
    mockNativeSignInWithGoogle.mockResolvedValueOnce({ credential: null, user: null });

    await expect(signInWithGoogle()).rejects.toThrow(/idToken/i);
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
    // Must not fall back to the popup flow — that would crash inside the WebView.
    expect(mockSignInWithPopup).not.toHaveBeenCalled();
  });

  it("throws when the plugin returns a credential with no idToken", async () => {
    mockNativeSignInWithGoogle.mockResolvedValueOnce({
      credential: { accessToken: "only-access" },
      user: null,
    });

    await expect(signInWithGoogle()).rejects.toThrow(/idToken/i);
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
    expect(mockSignInWithPopup).not.toHaveBeenCalled();
  });

  it("rethrows errors from the native plugin (e.g. user cancelled)", async () => {
    const err = Object.assign(new Error("canceled"), { code: "auth/cancelled" });
    mockNativeSignInWithGoogle.mockRejectedValueOnce(err);

    await expect(signInWithGoogle()).rejects.toBe(err);
    expect(mockSignInWithCredential).not.toHaveBeenCalled();
    expect(mockSignInWithPopup).not.toHaveBeenCalled();
  });
});
