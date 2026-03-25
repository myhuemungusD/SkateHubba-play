import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/auth ─────────────────────── */
const mockUserCredential = {
  user: { uid: "u1", email: "a@b.com", emailVerified: false },
};
const mockCreateUser = vi.fn().mockResolvedValue(mockUserCredential);
const mockSignInUser = vi.fn().mockResolvedValue(mockUserCredential);
const mockSignOut = vi.fn().mockResolvedValue(undefined);
const mockSendReset = vi.fn().mockResolvedValue(undefined);
const mockSendVerify = vi.fn().mockResolvedValue(undefined);
const mockOnAuthStateChanged = vi.fn();
const mockDeleteUser = vi.fn().mockResolvedValue(undefined);
const mockGetRedirectResult = vi.fn();

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) => mockCreateUser(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignInUser(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  sendPasswordResetEmail: (...args: unknown[]) => mockSendReset(...args),
  sendEmailVerification: (...args: unknown[]) => mockSendVerify(...args),
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
  getRedirectResult: (...args: unknown[]) => mockGetRedirectResult(...args),
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
}));

vi.mock("../../firebase");

import {
  signUp,
  signIn,
  signOut,
  resetPassword,
  resendVerification,
  reloadUser,
  onAuthChange,
  deleteAccount,
  resolveGoogleRedirect,
} from "../auth";
import { auth } from "../../firebase";

beforeEach(() => {
  vi.clearAllMocks();
  (auth as unknown as { currentUser: unknown }).currentUser = null;
});

/* ── Tests ──────────────────────────────────── */

describe("auth service", () => {
  describe("signUp", () => {
    it("creates a user and returns the User object", async () => {
      const user = await signUp("a@b.com", "pass123");
      expect(mockCreateUser).toHaveBeenCalledWith(auth, "a@b.com", "pass123");
      expect(user).toEqual(mockUserCredential.user);
    });

    it("sends a verification email (fire-and-forget)", async () => {
      await signUp("a@b.com", "pass123");
      expect(mockSendVerify).toHaveBeenCalledWith(mockUserCredential.user, {
        url: expect.any(String),
        handleCodeInApp: false,
      });
    });

    it("swallows verification email errors silently", async () => {
      mockSendVerify.mockRejectedValueOnce(new Error("email quota exceeded"));
      // signUp should still succeed — the email is fire-and-forget
      const user = await signUp("a@b.com", "pass123");
      expect(user).toEqual(mockUserCredential.user);
    });
  });

  describe("signIn", () => {
    it("signs in and returns the User object", async () => {
      const user = await signIn("a@b.com", "pass123");
      expect(mockSignInUser).toHaveBeenCalledWith(auth, "a@b.com", "pass123");
      expect(user).toEqual(mockUserCredential.user);
    });
  });

  describe("signOut", () => {
    it("calls firebase signOut", async () => {
      await signOut();
      expect(mockSignOut).toHaveBeenCalledWith(auth);
    });
  });

  describe("resetPassword", () => {
    it("sends a password reset email", async () => {
      await resetPassword("a@b.com");
      expect(mockSendReset).toHaveBeenCalledWith(auth, "a@b.com", {
        url: expect.any(String),
        handleCodeInApp: false,
      });
    });
  });

  describe("resendVerification", () => {
    it("sends verification when there is a current user", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = { uid: "u1" };
      await resendVerification();
      expect(mockSendVerify).toHaveBeenCalledWith(
        { uid: "u1" },
        {
          url: expect.any(String),
          handleCodeInApp: false,
        },
      );
    });

    it("does nothing when there is no current user", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = null;
      await resendVerification();
      expect(mockSendVerify).not.toHaveBeenCalled();
    });
  });

  describe("reloadUser", () => {
    it("reloads the current user and returns emailVerified", async () => {
      const mockUser = { uid: "u1", emailVerified: true, reload: vi.fn().mockResolvedValue(undefined) };
      (auth as unknown as { currentUser: unknown }).currentUser = mockUser;
      const result = await reloadUser();
      expect(mockUser.reload).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("returns null when there is no current user", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = null;
      const result = await reloadUser();
      expect(result).toBeNull();
    });
  });

  describe("onAuthChange", () => {
    it("registers a listener via onAuthStateChanged", () => {
      const cb = vi.fn();
      onAuthChange(cb);
      expect(mockOnAuthStateChanged).toHaveBeenCalledWith(auth, expect.any(Function));
    });

    it("forwards the user to the callback with debug logging", () => {
      const cb = vi.fn();
      onAuthChange(cb);
      // Get the wrapper function passed to onAuthStateChanged
      const wrapper = mockOnAuthStateChanged.mock.calls[0][1];
      const fakeUser = { uid: "u1", email: "a@b.com", emailVerified: true, providerData: [{ providerId: "password" }] };
      wrapper(fakeUser);
      expect(cb).toHaveBeenCalledWith(fakeUser);
    });

    it("forwards null to the callback on sign-out", () => {
      const cb = vi.fn();
      onAuthChange(cb);
      const wrapper = mockOnAuthStateChanged.mock.calls[0][1];
      wrapper(null);
      expect(cb).toHaveBeenCalledWith(null);
    });
  });

  describe("deleteAccount", () => {
    it("deletes the current user when signed in", async () => {
      const mockUser = { uid: "u1" };
      (auth as unknown as { currentUser: unknown }).currentUser = mockUser;
      await deleteAccount();
      expect(mockDeleteUser).toHaveBeenCalledWith(mockUser);
    });

    it("throws when no user is signed in", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = null;
      await expect(deleteAccount()).rejects.toThrow("Not signed in");
    });
  });

  describe("resolveGoogleRedirect", () => {
    it("returns the user when a redirect result is present", async () => {
      const fakeUser = { uid: "u1" };
      mockGetRedirectResult.mockResolvedValueOnce({ user: fakeUser });
      const user = await resolveGoogleRedirect();
      expect(user).toEqual(fakeUser);
    });

    it("returns null when no redirect is in progress", async () => {
      mockGetRedirectResult.mockResolvedValueOnce(null);
      const user = await resolveGoogleRedirect();
      expect(user).toBeNull();
    });

    it("returns null on error (e.g. cross-origin iframe restriction)", async () => {
      mockGetRedirectResult.mockRejectedValueOnce(new Error("cross-origin"));
      const user = await resolveGoogleRedirect();
      expect(user).toBeNull();
    });
  });
});
