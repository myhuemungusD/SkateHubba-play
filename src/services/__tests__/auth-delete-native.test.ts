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

vi.mock("../../firebase");

vi.stubGlobal("fetch", mockFetch);

import { deleteAccount } from "../auth";
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

describe("deleteAccount — native shell", () => {
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
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, authDeleted: true }),
    });

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
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true, authDeleted: true }),
    });

    await expect(deleteAccount("u1")).resolves.toEqual({ authDeleted: true });
    expect(mockFetch.mock.calls[0][0]).toBe("/api/account/delete");
  });
});
