import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockIsNative, mockSignInWithApple, mockCaptureMessage, auth } = vi.hoisted(() => ({
  mockIsNative: vi.fn(() => true),
  mockSignInWithApple: vi.fn(),
  mockCaptureMessage: vi.fn(),
  auth: {
    config: { apiHost: "identitytoolkit.googleapis.com", apiScheme: "https", apiKey: "test-key" },
    emulatorConfig: null as null | { protocol: string; host: string; port: number | null },
    tenantId: null as string | null,
  },
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: mockIsNative } }));
vi.mock("@capacitor-firebase/authentication", () => ({
  FirebaseAuthentication: { signInWithApple: (...a: unknown[]) => mockSignInWithApple(...a) },
}));
vi.mock("../../firebase", () => ({ requireAuth: () => auth }));
vi.mock("../../lib/sentry", () => ({ captureMessage: mockCaptureMessage, addBreadcrumb: vi.fn() }));

import { APPLE_REVOKE_TIMEOUT_MS, revokeAppleTokensIfNeeded } from "../auth.appleRevoke";
import { hashUid } from "../../utils/pii";
import type { User } from "firebase/auth";

const getIdToken = vi.fn();
const appleUser = { uid: "u1", providerData: [{ providerId: "apple.com" }], getIdToken } as unknown as User;
const googleUser = { uid: "u2", providerData: [{ providerId: "google.com" }] } as unknown as User;
const fetchMock = vi.fn();

const ok = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
const lastBody = () => JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<string, string>;

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNative.mockReturnValue(true);
  auth.emulatorConfig = null;
  auth.tenantId = null;
  getIdToken.mockResolvedValue("firebase-id-token");
  mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
  fetchMock.mockImplementation(ok);
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("revokeAppleTokensIfNeeded", () => {
  it("skips non-Apple accounts, accounts with no provider data, and the web", async () => {
    expect(await revokeAppleTokensIfNeeded(googleUser)).toBe("not-apple");
    expect(await revokeAppleTokensIfNeeded({ uid: "u3" } as unknown as User)).toBe("not-apple");
    mockIsNative.mockReturnValue(false);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("not-apple");
    expect(mockSignInWithApple).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("revokes the authorization code as tokenType CODE with the user's ID token", async () => {
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("revoked");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=test-key");
    expect(init).toMatchObject({ method: "POST", headers: { "Content-Type": "application/json" } });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    // Never ACCESS_TOKEN: the native Apple sheet returns a code, not a token.
    expect(lastBody()).toEqual({
      providerId: "apple.com",
      tokenType: "CODE",
      token: "code123",
      idToken: "firebase-id-token",
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("sends the tenant and targets the Auth emulator when configured", async () => {
    auth.tenantId = "tenant-1";
    auth.emulatorConfig = { protocol: "http", host: "localhost", port: 9099 };
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("revoked");
    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://localhost:9099/identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=test-key",
    );
    expect(lastBody().tenantId).toBe("tenant-1");
  });

  it("omits the port for an emulator host without one", async () => {
    auth.emulatorConfig = { protocol: "https", host: "emu.example", port: null };
    await revokeAppleTokensIfNeeded(appleUser);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://emu.example/identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=test-key",
    );
  });

  it("reports cancel when the Apple sheet is dismissed, before any request", async () => {
    mockSignInWithApple.mockRejectedValue(new Error("The operation couldn't be completed. (error 1001.)"));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("cancelled");
    mockSignInWithApple.mockRejectedValue(new Error("User cancelled"));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("cancelled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["the sheet fails", () => mockSignInWithApple.mockRejectedValue(new Error("network")), "reauth_failed", "network"],
    ["the sheet returns no credential", () => mockSignInWithApple.mockResolvedValue({}), "no_code", undefined],
    [
      "the credential has no code",
      () => mockSignInWithApple.mockResolvedValue({ credential: {} }),
      "no_code",
      undefined,
    ],
    [
      "Identity Toolkit rejects with an error body",
      () =>
        fetchMock.mockResolvedValue({
          ok: false,
          status: 400,
          json: () => Promise.resolve({ error: { message: "INVALID_IDP_RESPONSE" } }),
        }),
      "failed",
      "revokeToken rejected: INVALID_IDP_RESPONSE",
    ],
    [
      "Identity Toolkit rejects with no JSON body",
      () => fetchMock.mockResolvedValue({ ok: false, status: 502, json: () => Promise.reject(new Error("html")) }),
      "failed",
      "revokeToken rejected: http-502",
    ],
    [
      "the error body has no string message",
      () => fetchMock.mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({ error: {} }) }),
      "failed",
      "revokeToken rejected: http-400",
    ],
    ["the network call throws", () => fetchMock.mockRejectedValue(new Error("offline")), "failed", "offline"],
    ["the ID token refresh fails", () => getIdToken.mockRejectedValue(new Error("token")), "failed", "token"],
  ])("fails open and reports a warning when %s", async (_label, arrange, stage, message) => {
    arrange();
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockCaptureMessage).toHaveBeenCalledWith(`Sign in with Apple token revoke ${stage}`, {
      level: "warning",
      extra: {
        context: "account deletion continues without Apple revoke",
        uidHash: hashUid("u1"),
        stage,
        message,
      },
    });
    // Sentry gets the hashed uid only, never the raw one.
    expect(JSON.stringify(mockCaptureMessage.mock.calls)).not.toContain('"u1"');
  });

  it("gives up after the timeout and aborts the request, so deletion never hangs", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));
    });
    const pending = revokeAppleTokensIfNeeded(appleUser);
    await vi.advanceTimersByTimeAsync(APPLE_REVOKE_TIMEOUT_MS - 1);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe("failed");
    expect(signal?.aborted).toBe(true);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "Sign in with Apple token revoke timeout",
      expect.objectContaining({ extra: expect.objectContaining({ stage: "timeout" }) }),
    );
  });

  it("times out a stalled ID token refresh too", async () => {
    vi.useFakeTimers();
    getIdToken.mockReturnValue(new Promise(() => {}));
    const pending = revokeAppleTokensIfNeeded(appleUser);
    await vi.advanceTimersByTimeAsync(APPLE_REVOKE_TIMEOUT_MS);
    expect(await pending).toBe("failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
