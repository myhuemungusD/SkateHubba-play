import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Native-shell guard on `deleteAccount`.
 *
 * `auth.test.ts` covers the web paths, where the app is served from the same
 * origin as the API and a relative URL is correct. It deliberately does not
 * mock `@capacitor/core`, so `isNativePlatform()` is false there and this
 * branch is unreachable — hence a separate file, matching the split already
 * used by `auth-google-native.test.ts`.
 *
 * What is being guarded: under Capacitor the webview origin is
 * `capacitor://localhost` (iOS) / `https://localhost` (Android). A relative
 * `/api/account/delete` therefore resolves to the webview itself, where no API
 * exists, and `window.location.origin` is the same dead end — so there is no
 * runtime fallback that works. The deployed origin has to come from
 * `VITE_APP_URL` at build time. If it is missing, failing immediately is the
 * only honest outcome: account deletion is App Store mandated, and a request
 * that cannot succeed would strand the user in a flow that appears to work.
 */

// Built rather than spelled out: the `firebase/auth` and `lib/sentry` stubs are
// pure boilerplate shared with `auth.test.ts` / `auth-google-native.test.ts`,
// and repeating them verbatim trips the test-duplication gate. Only the members
// this file actually asserts on are named individually.
const { mockIsNativePlatform, mockSignOut, mockFetch, firebaseAuthStub, sentryStub } = vi.hoisted(() => {
  const signOut = vi.fn((..._args: unknown[]) => Promise.resolve());
  const captureException = vi.fn();
  const stubs = (...names: string[]) => Object.fromEntries(names.map((n) => [n, vi.fn()]));
  return {
    mockIsNativePlatform: vi.fn(() => true),
    mockSignOut: signOut,
    mockFetch: vi.fn(),
    firebaseAuthStub: {
      signOut: (...args: unknown[]) => signOut(...args),
      ...stubs(
        "createUserWithEmailAndPassword",
        "signInWithEmailAndPassword",
        "sendPasswordResetEmail",
        "sendEmailVerification",
        "onAuthStateChanged",
        "getRedirectResult",
        "GoogleAuthProvider",
        "OAuthProvider",
        "signInWithPopup",
        "signInWithRedirect",
        "signInWithCredential",
      ),
    },
    sentryStub: {
      captureException: (...args: unknown[]) => captureException(...args),
      ...stubs("captureMessage", "addBreadcrumb", "setUser", "initSentry"),
    },
  };
});

vi.mock("firebase/auth", () => firebaseAuthStub);

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mockIsNativePlatform },
}));

vi.mock("@capacitor-firebase/authentication", () => ({
  FirebaseAuthentication: { signInWithGoogle: vi.fn(), signOut: vi.fn() },
}));

vi.mock("../../lib/sentry", () => sentryStub);

const { mockAppleRevoke, mockReportRevokeFailure } = vi.hoisted(() => ({
  mockAppleRevoke: vi.fn(() => Promise.resolve("not-apple")),
  mockReportRevokeFailure: vi.fn(),
}));
vi.mock("../auth.appleRevoke", () => ({
  revokeAppleTokensIfNeeded: mockAppleRevoke,
  reportRevokeFailure: mockReportRevokeFailure,
}));

const mockLog = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: mockLog, metrics: {} }));

vi.mock("../../firebase");

vi.stubGlobal("fetch", mockFetch);

import { deleteAccount } from "../auth";
import { APPLE_CANCEL_MESSAGE, APPLE_REVOKE_FAILED_MESSAGE, APPLE_SETTINGS_PATH } from "../auth.deleteAccount";
import { auth } from "../../firebase";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(true);
  (auth as unknown as { currentUser: unknown }).currentUser = {
    uid: "u1",
    getIdToken: vi.fn().mockResolvedValue("id-token"),
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const okAuthDeletedResponse = () => ({
  ok: true,
  status: 200,
  json: vi.fn().mockResolvedValue({ ok: true, authDeleted: true }),
});

// Resolves to the error deleteAccount stopped with; fails the test if it went through.
const rejectionOf = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("expected deleteAccount to stop");
    },
    (e: unknown) => e as Error & { code?: string },
  );

describe("deleteAccount — native shell", () => {
  // Guideline 5.1.1(v): deleting after a revoke that didn't land would leave
  // SkateHubba in the user's "Apps Using Apple ID" list. A failed revoke
  // (sheet error, no code, REST error, timeout, or an unexpected throw) stops
  // the delete with nothing deleted, like a closed sheet, and Try Again
  // reopens the sheet. There is deliberately no "delete anyway" path.
  describe("when the Apple revoke fails", () => {
    beforeEach(() => {
      vi.stubEnv("VITE_APP_URL", "https://skatehubba.com");
      mockFetch.mockResolvedValue(okAuthDeletedResponse());
    });

    it("stops with nothing deleted when the revoke reports failed", async () => {
      mockAppleRevoke.mockResolvedValueOnce("failed");
      const err = await rejectionOf(deleteAccount("u1"));
      expect(err.code).toBe("account-delete/apple-revoke-failed");
      expect(err.message).toBe(APPLE_REVOKE_FAILED_MESSAGE);
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith("delete_account_apple_revoke_failed", { uid: "u1" });
      // The revoke helper already sent the one Sentry warning with its reason.
      expect(mockReportRevokeFailure).not.toHaveBeenCalled();
    });

    it("stops with nothing deleted when the revoke throws, and reports it once", async () => {
      mockAppleRevoke.mockRejectedValueOnce(new Error("revoke blew up"));
      const err = await rejectionOf(deleteAccount("u1"));
      expect(err.code).toBe("account-delete/apple-revoke-failed");
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockReportRevokeFailure.mock.calls).toEqual([["threw"]]);
    });

    it("deletes once a retry revokes", async () => {
      mockAppleRevoke.mockResolvedValueOnce("failed");
      expect((await rejectionOf(deleteAccount("u1"))).code).toBe("account-delete/apple-revoke-failed");
      mockAppleRevoke.mockResolvedValueOnce("revoked");
      await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("says nothing was deleted, how to retry and where to remove the app, naming no other platform", () => {
      expect(APPLE_REVOKE_FAILED_MESSAGE).toContain("nothing was deleted");
      expect(APPLE_REVOKE_FAILED_MESSAGE).toContain("Try Again");
      expect(APPLE_REVOKE_FAILED_MESSAGE).toContain(APPLE_SETTINGS_PATH);
      expect(APPLE_REVOKE_FAILED_MESSAGE).not.toMatch(/android|google|play store|web|anyway/i);
    });
  });

  describe("when the Apple sheet is closed", () => {
    const cancelled = () => mockAppleRevoke.mockResolvedValueOnce("cancelled");
    beforeEach(() => {
      vi.stubEnv("VITE_APP_URL", "https://skatehubba.com");
      mockFetch.mockResolvedValue(okAuthDeletedResponse());
    });

    it("stops with nothing deleted every time, however often the sheet is closed", async () => {
      const report = (sentryStub as unknown as { captureMessage: ReturnType<typeof vi.fn> }).captureMessage;
      report.mockClear();
      for (let i = 0; i < 3; i++) {
        cancelled();
        const err = await rejectionOf(deleteAccount("u1"));
        expect(err.code).toBe("account-delete/cancelled");
        expect(err.message).toBe(APPLE_CANCEL_MESSAGE);
      }
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockSignOut).not.toHaveBeenCalled();
      // A cancel is a user choice, not a revoke failure: its own tag, info level, no uid.
      expect(mockReportRevokeFailure).not.toHaveBeenCalled();
      expect(report.mock.calls).toEqual(
        Array(3).fill(["apple_revoke_cancelled", { level: "info", tags: { apple_revoke: "cancelled" } }]),
      );
    });

    it("deletes once the user confirms with Apple after a cancel", async () => {
      cancelled();
      expect((await rejectionOf(deleteAccount("u1"))).code).toBe("account-delete/cancelled");
      mockAppleRevoke.mockResolvedValueOnce("revoked");
      await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: true });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("tells the user how to finish on iPhone, and names no other platform", () => {
      expect(APPLE_CANCEL_MESSAGE).toContain("Nothing was deleted");
      expect(APPLE_CANCEL_MESSAGE).toContain("Try Again");
      expect(APPLE_CANCEL_MESSAGE).toContain("Settings → your name → Sign-In & Security → Sign in with Apple");
      expect(APPLE_CANCEL_MESSAGE).not.toMatch(/android|google|play store|web/i);
    });
  });

  it("refuses to call a URL that cannot resolve when VITE_APP_URL is unset", async () => {
    vi.stubEnv("VITE_APP_URL", "");

    const err = (await deleteAccount("u1").then(
      () => {
        throw new Error("expected deleteAccount to reject on native without VITE_APP_URL");
      },
      (e: unknown) => e as Error & { code?: string },
    )) as Error & { code?: string };

    expect(err.code).toBe("account-delete/misconfigured");
    // The request must never be attempted — a relative URL on native resolves
    // to the webview, so firing it would fail confusingly rather than clearly.
    expect(mockFetch).not.toHaveBeenCalled();
    // Nothing was deleted, so the session must survive.
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("uses the configured origin on native when VITE_APP_URL is set", async () => {
    vi.stubEnv("VITE_APP_URL", "https://skatehubba.com");
    mockFetch.mockResolvedValue(okAuthDeletedResponse());

    await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: true });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    // Absolute, and pointed at the deployed API rather than the webview.
    expect(mockFetch.mock.calls[0][0]).toBe("https://skatehubba.com/api/account/delete");
  });

  it("does not apply the native guard on web, where a relative URL is correct", async () => {
    // Same missing-env condition, non-native platform: the relative path is
    // same-origin and works, so this must not be treated as a misconfiguration.
    mockIsNativePlatform.mockReturnValue(false);
    vi.stubEnv("VITE_APP_URL", "");
    mockFetch.mockResolvedValue(okAuthDeletedResponse());

    await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: true });
    expect(mockFetch.mock.calls[0][0]).toBe("/api/account/delete");
  });

  /**
   * Permanent echo check: a caught error's message is free text (a plugin,
   * the network stack or Firebase) and can carry a uid, an email, a path or
   * an Apple code. Only a code or the error's class name may be logged.
   */
  describe("never logs a raw error message", () => {
    const SECRET = "secret-echo-u1-a@b.com-code123";
    const coded = (code: string) => Object.assign(new Error(SECRET), { code });

    beforeEach(() => {
      vi.stubEnv("VITE_APP_URL", "https://skatehubba.com");
      mockFetch.mockResolvedValue(okAuthDeletedResponse());
    });

    afterEach(() => {
      expect(JSON.stringify(Object.values(mockLog).map((fn) => fn.mock.calls))).not.toContain(SECRET);
    });

    it("when the Apple revoke throws", async () => {
      mockAppleRevoke.mockRejectedValueOnce(new Error(SECRET));
      await expect(deleteAccount("u1")).rejects.toMatchObject({ code: "account-delete/apple-revoke-failed" });
      expect(mockLog.warn).toHaveBeenCalledWith("delete_account_apple_revoke_threw", { uid: "u1", error: "Error" });
    });

    it("when the request never reaches the server", async () => {
      mockFetch.mockRejectedValueOnce(new TypeError(SECRET));
      await expect(deleteAccount("u1")).rejects.toMatchObject({ code: "account-delete/network" });
      expect(mockLog.error).toHaveBeenCalledWith("delete_account_request_failed", { uid: "u1", error: "TypeError" });
    });

    it("when clearing the local session fails", async () => {
      mockSignOut.mockRejectedValueOnce(coded("auth/network-request-failed"));
      await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: true });
      expect(mockLog.warn).toHaveBeenCalledWith("delete_account_signout_failed", {
        uid: "u1",
        error: "auth/network-request-failed",
      });
    });
  });
});
