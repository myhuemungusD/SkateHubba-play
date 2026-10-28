import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockIsNative, mockSignInWithApple, mockFetch, mockApiKey, mockAppCheckOn, mockGetAppCheckToken } = vi.hoisted(
  () => ({
    mockIsNative: vi.fn(() => true),
    mockSignInWithApple: vi.fn(),
    mockFetch: vi.fn(),
    mockApiKey: { value: "test-key" as string | undefined },
    mockAppCheckOn: vi.fn(() => false),
    mockGetAppCheckToken: vi.fn(),
  }),
);
const { mockCaptureMessage, mockLog, mockSentryOther } = vi.hoisted(() => ({
  mockCaptureMessage: vi.fn(),
  mockLog: vi.fn(),
  mockSentryOther: vi.fn(),
}));

vi.mock("firebase/auth", () => ({}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: mockIsNative } }));
vi.mock("@capacitor-firebase/authentication", () => ({
  FirebaseAuthentication: { signInWithApple: (...a: unknown[]) => mockSignInWithApple(...a) },
}));
vi.mock("../../firebase", () => ({
  requireAuth: () => ({ app: { options: { apiKey: mockApiKey.value } } }),
  ensureAppCheck: () => Promise.resolve(),
  isAppCheckInitialized: () => mockAppCheckOn(),
}));
vi.mock("@capacitor-firebase/app-check", () => ({
  FirebaseAppCheck: { getToken: (...a: unknown[]) => mockGetAppCheckToken(...a) },
}));

vi.mock("../../lib/sentry", () => ({
  captureMessage: mockCaptureMessage,
  captureException: mockSentryOther,
  addBreadcrumb: mockSentryOther,
}));
vi.mock("../logger", () => ({ logger: { info: mockLog, warn: mockLog, error: mockLog, debug: mockLog } }));

import { revokeAppleTokensIfNeeded, reportRevokeFailure, type RevokeFailureReason } from "../auth.appleRevoke";
import type { User } from "firebase/auth";

const makeUser = (overrides: Partial<User> = {}): User =>
  ({
    uid: "u1",
    providerData: [{ providerId: "apple.com" }],
    getIdToken: vi.fn().mockResolvedValue("id-token"),
    ...overrides,
  }) as unknown as User;

const appleUser = makeUser();
const googleUser = makeUser({ uid: "u2", providerData: [{ providerId: "google.com" }] as User["providerData"] });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNative.mockReturnValue(true);
  mockApiKey.value = "test-key";
  mockAppCheckOn.mockReturnValue(false);
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  // Nothing secret may reach a log line or Sentry, whatever the outcome. The
  // uid may go to the logger (it redacts), never to a Sentry event.
  const logged = JSON.stringify(mockLog.mock.calls);
  const reported = JSON.stringify([mockCaptureMessage.mock.calls, mockSentryOther.mock.calls]);
  for (const secret of ["code123", "id-token", "fake-appcheck-token"]) {
    expect(logged).not.toContain(secret);
    expect(reported).not.toContain(secret);
  }
  expect(reported).not.toContain('"u1"');
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const expectReported = (reason: RevokeFailureReason, detail: Record<string, unknown> = {}) => {
  expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
  expect(mockCaptureMessage).toHaveBeenCalledWith("apple_revoke_failed", {
    level: "warning",
    tags: { apple_revoke: "failed", apple_revoke_reason: reason },
    extra: { reason, ...detail },
  });
};

const okResponse = () =>
  ({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({}),
  }) as unknown as Response;

describe("revokeAppleTokensIfNeeded", () => {
  it("skips non-Apple accounts", async () => {
    expect(await revokeAppleTokensIfNeeded(googleUser)).toBe("not-apple");
    expect(mockSignInWithApple).not.toHaveBeenCalled();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("skips accounts with no provider data", async () => {
    expect(await revokeAppleTokensIfNeeded({ uid: "u3" } as unknown as User)).toBe("not-apple");
  });

  it("skips on the web", async () => {
    mockIsNative.mockReturnValue(false);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("not-apple");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails open when the sheet returns no credential", async () => {
    mockSignInWithApple.mockResolvedValue({});
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
    expectReported("no_code");
  });

  it("fails open when the credential has no authorization code", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: {} });
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
    expectReported("no_code");
  });

  it("revokes by POSTing the fresh code to v2/accounts:revokeToken with tokenType CODE", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue(okResponse());

    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("revoked");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=test-key");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({
      idToken: "id-token",
      providerId: "apple.com",
      tokenType: "CODE",
      token: "code123",
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  describe("App Check header", () => {
    const sentHeaders = () => (mockFetch.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    beforeEach(() => {
      mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
      mockFetch.mockResolvedValue(okResponse());
    });

    it("attaches X-Firebase-AppCheck when App Check is running", async () => {
      mockAppCheckOn.mockReturnValue(true);
      mockGetAppCheckToken.mockResolvedValue({ token: "fake-appcheck-token" });
      expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("revoked");
      expect(mockGetAppCheckToken).toHaveBeenCalledWith({ forceRefresh: false });
      expect(sentHeaders()).toEqual({
        "Content-Type": "application/json",
        "X-Firebase-AppCheck": "fake-appcheck-token",
      });
    });

    it("sends no header when App Check is off", async () => {
      expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("revoked");
      expect(mockGetAppCheckToken).not.toHaveBeenCalled();
      expect(sentHeaders()).toEqual({ "Content-Type": "application/json" });
    });

    it("sends no header when the plugin hands back an empty token", async () => {
      mockAppCheckOn.mockReturnValue(true);
      mockGetAppCheckToken.mockResolvedValue({ token: "" });
      expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("revoked");
      expect(sentHeaders()).toEqual({ "Content-Type": "application/json" });
    });

    it("gives App Check about 2 s, then revokes without the header", async () => {
      vi.useFakeTimers();
      mockAppCheckOn.mockReturnValue(true);
      mockGetAppCheckToken.mockImplementation(() => new Promise(() => {}));
      const pending = revokeAppleTokensIfNeeded(appleUser);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(mockFetch).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(await pending).toBe("revoked");
      expect(sentHeaders()).toEqual({ "Content-Type": "application/json" });
      expect(vi.getTimerCount()).toBe(0);
    });

    it("fails soft and still revokes when the App Check token can't be had", async () => {
      mockAppCheckOn.mockReturnValue(true);
      mockGetAppCheckToken.mockRejectedValue(new Error("attestation failed"));
      expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("revoked");
      expect(sentHeaders()).toEqual({ "Content-Type": "application/json" });
    });
  });

  // What the plugin really sends on iOS when the sheet is closed: no `code`,
  // Apple's NSError domain + code in the message (see isAppleSheetCancel).
  const IOS_SHEET_CLOSED =
    "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)";

  it("reports cancel when the Apple sheet is dismissed (iOS plugin shape: no code, NSError 1001)", async () => {
    mockSignInWithApple.mockRejectedValue(new Error(IOS_SHEET_CLOSED));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("cancelled");
    expect(mockFetch).not.toHaveBeenCalled();
    // A cancel is the user's choice, not a fault: breadcrumb only.
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["auth/popup-closed-by-user", { code: "auth/popup-closed-by-user", message: "The user closed the sheet." }],
    ["auth/cancelled-popup-request", { code: "auth/cancelled-popup-request", message: "Already presented." }],
    ["string code 1001", { code: "1001", message: "x" }],
    ["numeric code 1001", { code: 1001, message: "x" }],
  ])("reports cancel for error code %s", async (_label, err) => {
    mockSignInWithApple.mockRejectedValue(err);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("cancelled");
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["free text that says canceled", new Error("The user canceled the authorization attempt.")],
    ["a network request cancelled", new Error("The network request was cancelled.")],
    ["a different Apple error code", new Error("(com.apple.AuthenticationServices.AuthorizationError error 1000.)")],
    ["a bare 1001 in other text", new Error("error 1001")],
    ["a different Firebase code", { code: "auth/network-request-failed", message: "cancel" }],
    ["a non-object", "cancel 1001"],
  ])("treats %s as a failed revoke, not a cancel", async (_label, err) => {
    mockSignInWithApple.mockRejectedValue(err);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
    expectReported("sheet_error");
  });

  it("fails open when the sheet errors non-cancel", async () => {
    mockSignInWithApple.mockRejectedValue(new Error("network"));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
    expectReported("sheet_error");
  });

  it("fails open and reports the API error symbol when the REST endpoint rejects the code", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: { code: 400, message: "INVALID_GRANT", status: "INVALID_ARGUMENT" } }),
    } as unknown as Response);

    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expectReported("http", { status: 400, apiError: "INVALID_GRANT" });
  });

  it("fails open when the REST error body has only a status symbol", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: { status: "INVALID_ARGUMENT" } }),
    } as unknown as Response);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expectReported("http", { status: 400, apiError: "INVALID_ARGUMENT" });
  });

  it("fails open when the REST error body has neither message nor status", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: {} }),
    } as unknown as Response);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    // The `http-500` fallback is not an API symbol, so none is sent.
    expectReported("http", { status: 500, apiError: undefined });
  });

  it("fails open when the REST error body has no error field at all", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: vi.fn().mockResolvedValue(null),
    } as unknown as Response);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
  });

  it("keeps only the leading symbol of a free-form API error message", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: { message: "INVALID_ID_TOKEN : extra detail from the server" } }),
    } as unknown as Response);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expectReported("http", { status: 400, apiError: "INVALID_ID_TOKEN" });
  });

  it("never logs or reports the free-form tail of an API error, which can echo the code", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: { message: "INVALID_IDP_RESPONSE : Unable to parse code: code123" } }),
    } as unknown as Response);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    // The afterEach no-secret check covers every logger and Sentry call;
    // also pin exactly what is logged.
    expect(mockLog).toHaveBeenCalledWith("apple_revoke_failed", {
      uid: "u1",
      status: 400,
      error: "INVALID_IDP_RESPONSE",
    });
    expect(JSON.stringify([mockLog.mock.calls, mockCaptureMessage.mock.calls])).not.toContain("Unable to parse");
    expectReported("http", { status: 400, apiError: "INVALID_IDP_RESPONSE" });
  });

  it("falls back to the status symbol when the message has none", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: { message: "bad code123", status: "INVALID_ARGUMENT" } }),
    } as unknown as Response);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockLog).toHaveBeenCalledWith("apple_revoke_failed", { uid: "u1", status: 400, error: "INVALID_ARGUMENT" });
    expectReported("http", { status: 400, apiError: "INVALID_ARGUMENT" });
  });

  it("logs a plugin error code, never the plugin's message", async () => {
    mockSignInWithApple.mockRejectedValue(Object.assign(new Error("Apple said no to code123"), { code: "1000" }));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockLog).toHaveBeenCalledWith("apple_revoke_reauth_failed", { uid: "u1", error: "1000" });
  });

  it("logs the error class when the code field is free text", async () => {
    mockSignInWithApple.mockRejectedValue(Object.assign(new TypeError("boom"), { code: "not a code: code123" }));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockLog).toHaveBeenCalledWith("apple_revoke_reauth_failed", { uid: "u1", error: "TypeError" });
  });

  it("logs only the value type when the request rejects with a non-Error", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockRejectedValue("socket closed: code123");
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockLog).toHaveBeenCalledWith("apple_revoke_failed", { uid: "u1", error: "string" });
    expectReported("error");
  });

  it("fails open when the REST endpoint error body is unparseable", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: vi.fn().mockRejectedValue(new Error("bad json")),
    } as unknown as Response);

    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
  });

  it("fails open when the REST call throws", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockRejectedValue(new Error("network"));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expectReported("error");
  });

  it("fails open when the project has no API key", async () => {
    mockApiKey.value = undefined;
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
    expectReported("no_api_key");
  });

  it("never times the Apple sheet: a slow Face ID still revokes, and the budget starts after the sheet", async () => {
    vi.useFakeTimers();
    let resolveSheet: (v: unknown) => void = () => {};
    mockSignInWithApple.mockImplementation(() => new Promise((r) => (resolveSheet = r)));
    mockFetch.mockResolvedValue(okResponse());

    const pending = revokeAppleTokensIfNeeded(appleUser, { timeoutMs: 50 });
    // The user takes far longer than the network budget on the sheet.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mockFetch).not.toHaveBeenCalled();
    resolveSheet({ credential: { authorizationCode: "code123" } });

    expect(await pending).toBe("revoked");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("times out and proceeds when the ID token refresh hangs", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    const hangingUser = makeUser({ getIdToken: vi.fn(() => new Promise<string>(() => {})) });
    expect(await revokeAppleTokensIfNeeded(hangingUser, { timeoutMs: 10 })).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
    expectReported("timeout");
  });

  it("fails open when the ID token refresh rejects", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    const failingUser = makeUser({
      getIdToken: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("offline"), { code: "auth/network-request-failed" })),
    });
    expect(await revokeAppleTokensIfNeeded(failingUser)).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith("apple_revoke_failed", { uid: "u1", error: "auth/network-request-failed" });
    expectReported("error");
  });

  it("aborts the timed-out revoke request instead of leaving it running", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    let seenSignal: AbortSignal | undefined;
    mockFetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          seenSignal = init.signal ?? undefined;
          seenSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const outcome = await revokeAppleTokensIfNeeded(appleUser, { timeoutMs: 20 });
    expect(outcome).toBe("failed");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(seenSignal?.aborted).toBe(true);
    expectReported("timeout");
  });

  it("still bounds a fetch that ignores the abort signal", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockImplementation(() => new Promise(() => {}));
    expect(await revokeAppleTokensIfNeeded(appleUser, { timeoutMs: 20 })).toBe("failed");
  });

  it("does not start the request once the budget is already spent", async () => {
    vi.useFakeTimers();
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    // The token refresh eats the whole budget before it hands back.
    const slowUser = makeUser({
      getIdToken: vi.fn(() => {
        vi.advanceTimersByTime(100);
        return Promise.resolve("id-token");
      }),
    });
    expect(await revokeAppleTokensIfNeeded(slowUser, { timeoutMs: 50 })).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("clears its timer once the revoke settles", async () => {
    vi.useFakeTimers();
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue(okResponse());
    expect(await revokeAppleTokensIfNeeded(appleUser, { timeoutMs: 50 })).toBe("revoked");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reportRevokeFailure sends a fixed-shape warning for a thrown revoke", () => {
    reportRevokeFailure("threw");
    expectReported("threw");
  });
});
