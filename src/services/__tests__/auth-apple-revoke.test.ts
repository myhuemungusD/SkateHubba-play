import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsNative, mockSignInWithApple, mockRevoke } = vi.hoisted(() => ({
  mockIsNative: vi.fn(() => true),
  mockSignInWithApple: vi.fn(),
  mockRevoke: vi.fn(),
}));

vi.mock("firebase/auth", () => ({ revokeAccessToken: (...a: unknown[]) => mockRevoke(...a) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: mockIsNative } }));
vi.mock("@capacitor-firebase/authentication", () => ({
  FirebaseAuthentication: { signInWithApple: (...a: unknown[]) => mockSignInWithApple(...a) },
}));
vi.mock("../../firebase", () => ({ requireAuth: () => ({ name: "auth" }) }));

import { revokeAppleTokensIfNeeded } from "../auth.appleRevoke";
import type { User } from "firebase/auth";

const appleUser = { uid: "u1", providerData: [{ providerId: "apple.com" }] } as unknown as User;
const googleUser = { uid: "u2", providerData: [{ providerId: "google.com" }] } as unknown as User;

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNative.mockReturnValue(true);
});

describe("revokeAppleTokensIfNeeded", () => {
  it("skips non-Apple accounts", async () => {
    expect(await revokeAppleTokensIfNeeded(googleUser)).toBe("not-apple");
    expect(mockSignInWithApple).not.toHaveBeenCalled();
  });

  it("skips accounts with no provider data", async () => {
    expect(await revokeAppleTokensIfNeeded({ uid: "u3" } as unknown as User)).toBe("not-apple");
  });

  it("fails open when the sheet returns no credential", async () => {
    mockSignInWithApple.mockResolvedValue({});
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
  });

  it("skips on the web", async () => {
    mockIsNative.mockReturnValue(false);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("not-apple");
  });

  it("revokes with the fresh authorization code", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "code123" } });
    mockRevoke.mockResolvedValue(undefined);
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("revoked");
    expect(mockRevoke).toHaveBeenCalledWith({ name: "auth" }, "code123");
  });

  it("reports cancel when the Apple sheet is dismissed", async () => {
    mockSignInWithApple.mockRejectedValue(new Error("The operation couldn't be completed. (error 1001.)"));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("cancelled");
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it("fails open when no code comes back or revoke errors", async () => {
    mockSignInWithApple.mockResolvedValue({ credential: {} });
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    mockSignInWithApple.mockResolvedValue({ credential: { authorizationCode: "c" } });
    mockRevoke.mockRejectedValue(new Error("boom"));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
    mockSignInWithApple.mockRejectedValue(new Error("network"));
    expect(await revokeAppleTokensIfNeeded(appleUser)).toBe("failed");
  });
});
