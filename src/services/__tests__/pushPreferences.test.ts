/**
 * Push preference (Settings opt-out) service tests.
 *
 * The load-bearing property is the ENFORCEMENT, not the flag: disabling must
 * empty /pushTargets/{uid} so senders (and the admin cron) have nothing to
 * dispatch to. Enabling must re-arm the mirror WITHOUT prompting.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetDoc = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>(() => Promise.resolve(undefined)));
const mockDoc = vi.hoisted(() =>
  vi.fn<(...args: unknown[]) => unknown>((...args: unknown[]) => (args.slice(1) as string[]).join("/")),
);
vi.mock("firebase/firestore", () => ({
  doc: (...args: unknown[]) => mockDoc(...args),
  setDoc: (...args: unknown[]) => mockSetDoc(...args),
  serverTimestamp: () => "SERVER_TS",
}));

vi.mock("../../firebase", () => ({ requireDb: () => ({}) }));

const mockIsPushSupported = vi.hoisted(() => vi.fn<() => boolean>(() => false));
const mockRegisterIfGranted = vi.hoisted(() => vi.fn<(uid: string) => Promise<void>>(() => Promise.resolve()));
const mockRefreshWeb = vi.hoisted(() => vi.fn<(uid: string) => Promise<string | null>>(() => Promise.resolve("tok")));
vi.mock("../pushNotifications", () => ({
  isPushSupported: () => mockIsPushSupported(),
  registerPushTokenIfGranted: (uid: string) => mockRegisterIfGranted(uid),
}));
vi.mock("../fcm", () => ({
  refreshWebPushTokenIfGranted: (uid: string) => mockRefreshWeb(uid),
}));
vi.mock("../users", () => ({
  PRIVATE_PROFILE_DOC_ID: "profile",
  getPushEnabled: vi.fn(),
}));

import { setPushEnabled } from "../pushPreferences";

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks does not undo mockReturnValue, so pin the platform per test —
  // otherwise the native case leaks into every case after it.
  mockIsPushSupported.mockReturnValue(false);
});

describe("setPushEnabled — disable", () => {
  it("persists the preference and empties the token mirror", async () => {
    await setPushEnabled("u1", false);

    expect(mockSetDoc).toHaveBeenNthCalledWith(1, "users/u1/private/profile", { pushEnabled: false }, { merge: true });
    // Empty list (not a doc delete) keeps the write inside the /pushTargets
    // hasOnly(['tokens','updatedAt']) rule.
    expect(mockSetDoc).toHaveBeenNthCalledWith(
      2,
      "pushTargets/u1",
      { tokens: [], updatedAt: "SERVER_TS" },
      { merge: true },
    );
    expect(mockRegisterIfGranted).not.toHaveBeenCalled();
    expect(mockRefreshWeb).not.toHaveBeenCalled();
  });

  it("still resolves when the mirror clear fails (self-heals next toggle)", async () => {
    mockSetDoc.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("permission-denied"));
    await expect(setPushEnabled("u1", false)).resolves.toBeUndefined();
  });

  it("propagates a failure to save the preference itself", async () => {
    // User-initiated: Settings must be able to show "couldn't save" rather
    // than render a toggle state that never reached the server.
    mockSetDoc.mockRejectedValueOnce(new Error("permission-denied"));
    await expect(setPushEnabled("u1", false)).rejects.toThrow("permission-denied");
  });
});

describe("setPushEnabled — enable", () => {
  it("re-registers the web token when not on native", async () => {
    await setPushEnabled("u1", true);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    expect(mockRefreshWeb).toHaveBeenCalledWith("u1");
    expect(mockRegisterIfGranted).not.toHaveBeenCalled();
  });

  it("re-registers via the NON-prompting native path", async () => {
    mockIsPushSupported.mockReturnValue(true);
    await setPushEnabled("u1", true);
    expect(mockRegisterIfGranted).toHaveBeenCalledWith("u1");
  });

  it("keeps the preference saved even if re-registration throws", async () => {
    mockRefreshWeb.mockRejectedValueOnce(new Error("sw unavailable"));
    await expect(setPushEnabled("u1", true)).resolves.toBeUndefined();
    expect(mockSetDoc).toHaveBeenCalledWith("users/u1/private/profile", { pushEnabled: true }, { merge: true });
  });
});
