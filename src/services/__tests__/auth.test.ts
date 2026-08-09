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
const mockGetRedirectResult = vi.fn();
const mockCaptureException = vi.fn();

vi.mock("firebase/auth", () => ({
  createUserWithEmailAndPassword: (...args: unknown[]) => mockCreateUser(...args),
  signInWithEmailAndPassword: (...args: unknown[]) => mockSignInUser(...args),
  signOut: (...args: unknown[]) => mockSignOut(...args),
  sendPasswordResetEmail: (...args: unknown[]) => mockSendReset(...args),
  sendEmailVerification: (...args: unknown[]) => mockSendVerify(...args),
  onAuthStateChanged: (...args: unknown[]) => mockOnAuthStateChanged(...args),
  getRedirectResult: (...args: unknown[]) => mockGetRedirectResult(...args),
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
}));

/* ── mock global fetch (deleteAccount talks to /api/account/delete) ── */
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("../../lib/sentry", () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
  setUser: vi.fn(),
  initSentry: vi.fn(),
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

/* ── deleteAccount helpers ──────────────────── */

/** Endpoint contract shared with `api/account/delete.ts`. */
const DELETE_PATH = "/api/account/delete";
const ID_TOKEN = "id-token-abc";
/** Distinct from ID_TOKEN so a substring search for it is meaningful. */
const TARGET_UID = "uid-under-test";

/** Install a stand-in signed-in user and return it for assertions. */
function signInAs(uid: string): { uid: string; getIdToken: ReturnType<typeof vi.fn> } {
  const user = { uid, getIdToken: vi.fn().mockResolvedValue(ID_TOKEN) };
  (auth as unknown as { currentUser: unknown }).currentUser = user;
  return user;
}

interface FakeResponse {
  ok: boolean;
  status?: number;
  body?: unknown;
  /** Simulate a body that isn't JSON (HTML error page, empty 204, …). */
  unparsable?: boolean;
}

/** Queue the response the delete endpoint will return. */
function serverResponds({ ok, status, body, unparsable }: FakeResponse): void {
  mockFetch.mockResolvedValue({
    ok,
    status: status ?? (ok ? 200 : 400),
    json: unparsable
      ? vi.fn().mockRejectedValue(new SyntaxError("Unexpected token < in JSON at position 0"))
      : vi.fn().mockResolvedValue(body ?? {}),
  });
}

/** The single outbound request, asserted to be exactly one. */
function deleteRequest(): [string, RequestInit] {
  expect(mockFetch).toHaveBeenCalledTimes(1);
  return mockFetch.mock.calls[0] as [string, RequestInit];
}

/** Await a rejection and hand back the error with its `code`/`cause` typed. */
async function rejectionOf(promise: Promise<unknown>): Promise<Error & { code?: string; cause?: unknown }> {
  return await promise.then(
    () => {
      throw new Error("expected deleteAccount to reject, but it resolved");
    },
    (err: unknown) => err as Error & { code?: string; cause?: unknown },
  );
}

/* ── Tests ──────────────────────────────────── */

describe("auth service", () => {
  describe("signUp", () => {
    it("creates a user and returns the User object with verificationEmailSent", async () => {
      const result = await signUp("a@b.com", "pass123");
      expect(mockCreateUser).toHaveBeenCalledWith(auth, "a@b.com", "pass123");
      expect(result.user).toEqual(mockUserCredential.user);
      expect(result.verificationEmailSent).toBe(true);
      // Successful sends must never surface throttled=true. Callers rely on
      // the invariant that `throttled` is only meaningful when the send failed.
      expect(result.throttled).toBe(false);
    });

    it("sends a verification email and awaits the result", async () => {
      await signUp("a@b.com", "pass123");
      expect(mockSendVerify).toHaveBeenCalledWith(mockUserCredential.user, {
        url: expect.any(String),
        handleCodeInApp: false,
      });
    });

    it("returns verificationEmailSent=false and throttled=false for a generic send failure", async () => {
      // Non-throttled error — the send is a hard failure but the UI must not
      // surface a "retry after cooldown" affordance for it.
      mockSendVerify.mockRejectedValueOnce(new Error("email quota exceeded"));
      const result = await signUp("a@b.com", "pass123");
      expect(result.user).toEqual(mockUserCredential.user);
      expect(result.verificationEmailSent).toBe(false);
      expect(result.throttled).toBe(false);
    });

    it("returns throttled=true when send fails with auth/too-many-requests", async () => {
      // Throttle error surfaced as a distinguishable flag so the UI can show
      // a cooldown banner instead of a generic "sign-up failed" toast.
      const throttleErr = Object.assign(new Error("throttled"), { code: "auth/too-many-requests" });
      mockSendVerify.mockRejectedValueOnce(throttleErr);
      const result = await signUp("a@b.com", "pass123");
      expect(result.verificationEmailSent).toBe(false);
      expect(result.throttled).toBe(true);
      // The account was still created — throttled is a send-side signal only.
      expect(result.user).toEqual(mockUserCredential.user);
    });

    it("returns throttled=true when send fails with auth/quota-exceeded", async () => {
      // Sibling quota-exceeded code — same UX treatment as too-many-requests.
      const quotaErr = Object.assign(new Error("quota"), { code: "auth/quota-exceeded" });
      mockSendVerify.mockRejectedValueOnce(quotaErr);
      const result = await signUp("a@b.com", "pass123");
      expect(result.verificationEmailSent).toBe(false);
      expect(result.throttled).toBe(true);
    });

    it("retries without actionCodeSettings on unauthorized-continue-uri", async () => {
      const uriError = Object.assign(new Error("unauthorized"), { code: "auth/unauthorized-continue-uri" });
      mockSendVerify.mockRejectedValueOnce(uriError).mockResolvedValueOnce(undefined);
      const result = await signUp("a@b.com", "pass123");
      expect(result.verificationEmailSent).toBe(true);
      expect(result.throttled).toBe(false);
      expect(mockSendVerify).toHaveBeenCalledTimes(2);
      // Second call should be without actionCodeSettings
      expect(mockSendVerify.mock.calls[1]).toEqual([mockUserCredential.user]);
    });

    it("returns verificationEmailSent=false when fallback retry also fails", async () => {
      const uriError = Object.assign(new Error("unauthorized"), { code: "auth/unauthorized-continue-uri" });
      // Error without .code to exercise the parseFirebaseError fallback branch
      const retryError = new Error("network timeout");
      mockSendVerify.mockRejectedValueOnce(uriError).mockRejectedValueOnce(retryError);
      const result = await signUp("a@b.com", "pass123");
      expect(result.verificationEmailSent).toBe(false);
      // Generic retry failure is not a throttle — keep the UX distinction.
      expect(result.throttled).toBe(false);
      expect(mockSendVerify).toHaveBeenCalledTimes(2);
    });

    it("returns throttled=true when the URI fallback retry hits auth/too-many-requests", async () => {
      // First call fails with a URI error (triggers the fallback branch); the
      // retry without actionCodeSettings then hits the throttle. The retry
      // path must set throttled=true too so the UX signal survives the
      // fallback.
      const uriError = Object.assign(new Error("unauthorized"), { code: "auth/unauthorized-continue-uri" });
      const throttleErr = Object.assign(new Error("throttled"), { code: "auth/too-many-requests" });
      mockSendVerify.mockRejectedValueOnce(uriError).mockRejectedValueOnce(throttleErr);
      const result = await signUp("a@b.com", "pass123");
      expect(result.verificationEmailSent).toBe(false);
      expect(result.throttled).toBe(true);
      expect(mockSendVerify).toHaveBeenCalledTimes(2);
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

    it("falls back to no actionCodeSettings on unauthorized-continue-uri", async () => {
      const uriError = Object.assign(new Error("unauthorized"), { code: "auth/unauthorized-continue-uri" });
      mockSendReset.mockRejectedValueOnce(uriError).mockResolvedValueOnce(undefined);
      await resetPassword("a@b.com");
      expect(mockSendReset).toHaveBeenCalledTimes(2);
      expect(mockSendReset.mock.calls[1]).toEqual([auth, "a@b.com"]);
    });

    it("falls back to no actionCodeSettings on invalid-continue-uri", async () => {
      const uriError = Object.assign(new Error("invalid"), { code: "auth/invalid-continue-uri" });
      mockSendReset.mockRejectedValueOnce(uriError).mockResolvedValueOnce(undefined);
      await resetPassword("a@b.com");
      expect(mockSendReset).toHaveBeenCalledTimes(2);
      expect(mockSendReset.mock.calls[1]).toEqual([auth, "a@b.com"]);
    });

    it("rethrows non-URI errors without falling back", async () => {
      mockSendReset.mockRejectedValueOnce(Object.assign(new Error("rate"), { code: "auth/too-many-requests" }));
      await expect(resetPassword("a@b.com")).rejects.toThrow("rate");
      expect(mockSendReset).toHaveBeenCalledTimes(1);
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

    it("falls back to no actionCodeSettings on unauthorized-continue-uri", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = { uid: "u1" };
      const uriError = Object.assign(new Error("unauthorized"), { code: "auth/unauthorized-continue-uri" });
      mockSendVerify.mockRejectedValueOnce(uriError).mockResolvedValueOnce(undefined);
      await resendVerification();
      expect(mockSendVerify).toHaveBeenCalledTimes(2);
      expect(mockSendVerify.mock.calls[1]).toEqual([{ uid: "u1" }]);
    });

    it("rethrows non-URI errors", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = { uid: "u1" };
      mockSendVerify.mockRejectedValueOnce(Object.assign(new Error("rate"), { code: "auth/too-many-requests" }));
      await expect(resendVerification()).rejects.toThrow("rate");
    });
  });

  describe("reloadUser", () => {
    it("reloads the current user and returns emailVerified", async () => {
      const mockUser = {
        uid: "u1",
        emailVerified: true,
        reload: vi.fn().mockResolvedValue(undefined),
        getIdToken: vi.fn().mockResolvedValue("token"),
      };
      (auth as unknown as { currentUser: unknown }).currentUser = mockUser;
      const result = await reloadUser();
      expect(mockUser.reload).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it("force-refreshes ID token when email is verified", async () => {
      const mockUser = {
        uid: "u1",
        emailVerified: true,
        reload: vi.fn().mockResolvedValue(undefined),
        getIdToken: vi.fn().mockResolvedValue("token"),
      };
      (auth as unknown as { currentUser: unknown }).currentUser = mockUser;
      await reloadUser();
      expect(mockUser.getIdToken).toHaveBeenCalledWith(true);
    });

    it("skips token refresh when email is not yet verified", async () => {
      const mockUser = {
        uid: "u1",
        emailVerified: false,
        reload: vi.fn().mockResolvedValue(undefined),
        getIdToken: vi.fn().mockResolvedValue("token"),
      };
      (auth as unknown as { currentUser: unknown }).currentUser = mockUser;
      const result = await reloadUser();
      expect(mockUser.reload).toHaveBeenCalled();
      expect(mockUser.getIdToken).not.toHaveBeenCalled();
      expect(result).toBe(false);
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
    beforeEach(() => {
      // clearAllMocks() wipes call history but leaves queued implementations,
      // so reset the fetch stub outright. Default: the happy path, which every
      // case that isn't specifically about the response can rely on.
      mockFetch.mockReset();
      serverResponds({ ok: true, body: { authDeleted: true } });
    });

    it("throws when no user is signed in", async () => {
      (auth as unknown as { currentUser: unknown }).currentUser = null;
      await expect(deleteAccount("u1")).rejects.toThrow("Not signed in");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("refuses to run when the signed-in uid does not match the requested uid", async () => {
      signInAs("u1");
      // Identity drift mid-delete must never reach the server.
      await expect(deleteAccount("different")).rejects.toThrow(/uid does not match/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("POSTs to the erasure endpoint with the ID token as a bearer credential", async () => {
      const user = signInAs("u1");
      await deleteAccount("u1");
      const [url, init] = deleteRequest();
      expect(user.getIdToken).toHaveBeenCalled();
      expect(url).toBe(DELETE_PATH);
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({ Authorization: `Bearer ${ID_TOKEN}` });
    });

    it("sends no uid and no username on the wire", async () => {
      // Security property: the server derives identity solely from the verified
      // token. If the client could name the account — or the username
      // reservation to release — a caller could aim erasure at someone else.
      signInAs(TARGET_UID);
      await deleteAccount(TARGET_UID);
      const [url, init] = deleteRequest();
      expect(init.body).toBeUndefined();
      expect(url).toBe(DELETE_PATH); // no query string either
      expect(Object.keys(init.headers as Record<string, string>)).toEqual(["Authorization"]);
      expect(JSON.stringify([url, init])).not.toContain(TARGET_UID);
    });

    it("prefixes the request with VITE_APP_URL when one is configured", async () => {
      vi.stubEnv("VITE_APP_URL", "https://skatehubba.test");
      try {
        signInAs("u1");
        await deleteAccount("u1");
        expect(deleteRequest()[0]).toBe(`https://skatehubba.test${DELETE_PATH}`);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it("clears the local session once the server confirms erasure", async () => {
      signInAs("u1");
      await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: true });
      expect(mockSignOut).toHaveBeenCalledWith(auth);
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it("resolves when the success body is not JSON", async () => {
      // 204, or a body mangled by a proxy. The erasure still happened, so a
      // body-parsing detail must not become a user-facing failure.
      signInAs("u1");
      serverResponds({ ok: true, unparsable: true });
      // An absent flag is not the same as an explicit `false` — only the server
      // saying so should hold the pending-delete marker open.
      await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: true });
      expect(mockSignOut).toHaveBeenCalledWith(auth);
      expect(mockCaptureException).not.toHaveBeenCalled();
    });

    it("resolves but alerts Sentry when the data is erased and the Auth user survives", async () => {
      signInAs("u1");
      serverResponds({ ok: true, body: { authDeleted: false } });
      // Reported to the caller, which keeps the pending-delete marker set so
      // the "Finish deletion" affordance stays reachable for the orphaned
      // Auth record.
      await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: false });
      expect(mockSignOut).toHaveBeenCalledWith(auth);
      expect(mockCaptureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("Auth user survived") }),
        expect.objectContaining({ level: "warning", extra: expect.objectContaining({ uid: "u1" }) }),
      );
    });

    it("still resolves when clearing the local session fails", async () => {
      // The server already killed the session; a failed local signOut is
      // cosmetic and must not tell the user their data is still there.
      signInAs("u1");
      mockSignOut.mockRejectedValueOnce(new Error("storage unavailable"));
      await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: true });
    });

    it("throws a retryable network code when the request never reaches the server", async () => {
      signInAs("u1");
      const netErr = new TypeError("Failed to fetch");
      mockFetch.mockRejectedValue(netErr);
      const err = await rejectionOf(deleteAccount("u1"));
      expect(err.code).toBe("account-delete/network");
      expect(err.cause).toBe(netErr);
      // Nothing was deleted, so the session must survive for the retry.
      expect(mockSignOut).not.toHaveBeenCalled();
    });

    // Both codes have the same remedy — re-authenticate — and AuthContext has a
    // single branch on the Firebase code plus a "Finish deletion" affordance.
    it.each(["requires_recent_login", "invalid_token"])(
      "maps server code %s to auth/requires-recent-login",
      async (serverCode) => {
        signInAs("u1");
        serverResponds({ ok: false, status: 401, body: { code: serverCode, message: "Sign in again to continue." } });
        const err = await rejectionOf(deleteAccount("u1"));
        expect(err.code).toBe("auth/requires-recent-login");
        expect(err.message).toBe("Sign in again to continue.");
        expect(mockSignOut).not.toHaveBeenCalled();
        // Expected, user-recoverable outcome — not an outage signal.
        expect(mockCaptureException).not.toHaveBeenCalled();
      },
    );

    it("namespaces an unrecognised server code and reports it to Sentry", async () => {
      signInAs("u1");
      serverResponds({ ok: false, status: 500, body: { code: "erase_failed", message: "Erasure stalled." } });
      const err = await rejectionOf(deleteAccount("u1"));
      expect(err.code).toBe("account-delete/erase_failed");
      expect(err.message).toBe("Erasure stalled.");
      expect(mockSignOut).not.toHaveBeenCalled();
      expect(mockCaptureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("erase_failed") }),
        expect.objectContaining({
          level: "error",
          extra: expect.objectContaining({ uid: "u1", status: 500, serverCode: "erase_failed" }),
        }),
      );
    });

    it("falls back to a generic code and message when the error body is not JSON", async () => {
      signInAs("u1");
      serverResponds({ ok: false, status: 502, unparsable: true });
      const err = await rejectionOf(deleteAccount("u1"));
      expect(err.code).toBe("account-delete/unknown");
      expect(err.message).toMatch(/Could not delete your account/);
    });

    it("ignores non-string code and message fields in the error body", async () => {
      // A proxy or a future server version can return anything. The thrown code
      // must stay a usable string, not "account-delete/[object Object]", and
      // the message must never be a raw object rendered into the UI.
      signInAs("u1");
      serverResponds({ ok: false, status: 500, body: { code: 42, message: { detail: "nope" } } });
      const err = await rejectionOf(deleteAccount("u1"));
      expect(err.code).toBe("account-delete/unknown");
      expect(err.message).toMatch(/Could not delete your account/);
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

    it("rethrows on error so the caller can apply its Sentry/UI policy", async () => {
      const err = new Error("cross-origin");
      mockGetRedirectResult.mockRejectedValueOnce(err);
      await expect(resolveGoogleRedirect()).rejects.toBe(err);
    });

    it("skips getRedirectResult in emulator mode", async () => {
      // Temporarily set isEmulatorMode to true
      const firebaseMod = await import("../../firebase");
      const original = firebaseMod.isEmulatorMode;
      Object.defineProperty(firebaseMod, "isEmulatorMode", { value: true, writable: true });
      try {
        const user = await resolveGoogleRedirect();
        expect(user).toBeNull();
        expect(mockGetRedirectResult).not.toHaveBeenCalled();
      } finally {
        Object.defineProperty(firebaseMod, "isEmulatorMode", { value: original, writable: true });
      }
    });
  });
});
