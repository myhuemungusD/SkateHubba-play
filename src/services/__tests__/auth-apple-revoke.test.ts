import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockIsNative, mockSignInWithApple, mockFetch, mockApiKey } = vi.hoisted(() => ({
  mockIsNative: vi.fn(() => true),
  mockSignInWithApple: vi.fn(),
  mockFetch: vi.fn(),
  mockApiKey: { value: "test-key" as string | undefined },
}));

vi.mock("firebase/auth", () => ({}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: mockIsNative } }));
vi.mock("@capacitor-firebase/authentication", () => ({
  FirebaseAuthentication: { signInWithApple: (...a: unknown[]) => mockSignInWithApple(...a) },
}));
vi.mock("../../firebase", () => ({
  requireAuth: () => ({ app: { options: { apiKey: mockApiKey.value } } }),
}));

import { revokeAppleTokensIfNeeded } from "../auth.appleRevoke";
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
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

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
  });

  it("fails open when the credential has no authorization code", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: {} });
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
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
  });

  it("reports cancel when the Apple sheet is dismissed", async () => {
    mockSignInWithApple.mockRejectedValue(new Error("The operation couldn't be completed. (error 1001.)"));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("cancelled");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails open when the sheet errors non-cancel", async () => {
    mockSignInWithApple.mockRejectedValue(new Error("network"));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("fails open and does not log tokens when the REST endpoint rejects the code", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: { code: 400, message: "INVALID_GRANT", status: "INVALID_ARGUMENT" } }),
    } as unknown as Response);

    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
  });

  it("fails open when the REST error body has only a status symbol", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: vi.fn().mockResolvedValue({ error: { status: "INVALID_ARGUMENT" } }),
    } as unknown as Response);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
  });

  it("fails open when the REST error body has neither message nor status", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: vi.fn().mockResolvedValue({ error: {} }),
    } as unknown as Response);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
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
  });

  it("fails open when the project has no API key", async () => {
    mockApiKey.value = undefined;
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    expect(mockFetch).not.toHaveBeenCalled();
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
  });

  it("times out and proceeds when the REST call hangs", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockFetch.mockImplementation(() => new Promise(() => {}));
    const outcome = await revokeAppleTokensIfNeeded(appleUser, { timeoutMs: 20 });
    expect(outcome).toBe("failed");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
