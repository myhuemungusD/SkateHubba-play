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

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) => mockCreateUser(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignInUser(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  sendPasswordResetEmail: (...args: unknown[]) => mockSendReset(...args),
  sendEmailVerification: (...args: unknown[]) => mockSendVerify(...args),
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
}));

vi.mock("../../firebase");

import { signUp, signIn, signOut, resetPassword, resendVerification, onAuthChange } from "../auth";
import { auth } from "../../firebase";

beforeEach(() => {
  vi.clearAllMocks();
  (auth as any).currentUser = null;
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
      (auth as any).currentUser = { uid: "u1" };
      await resendVerification();
      expect(mockSendVerify).toHaveBeenCalledWith({ uid: "u1" }, {
        url: expect.any(String),
        handleCodeInApp: false,
      });
    });

    it("does nothing when there is no current user", async () => {
      (auth as any).currentUser = null;
      await resendVerification();
      expect(mockSendVerify).not.toHaveBeenCalled();
    });
  });

  describe("onAuthChange", () => {
    it("registers a listener via onAuthStateChanged", () => {
      const cb = vi.fn();
      onAuthChange(cb);
      expect(mockOnAuthStateChanged).toHaveBeenCalledWith(auth, cb);
    });
  });
});
