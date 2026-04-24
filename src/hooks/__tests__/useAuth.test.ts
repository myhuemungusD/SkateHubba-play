import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/* ── mock services ──────────────────────────── */
let authChangeCallback: ((user: unknown) => void) | null = null;
const mockUnsubscribe = vi.fn();

const mockReloadUser = vi.fn();

vi.mock("../../services/auth", () => ({
  onAuthChange: vi.fn((cb: (user: unknown) => void) => {
    authChangeCallback = cb;
    return mockUnsubscribe;
  }),
  reloadUser: (...args: unknown[]) => mockReloadUser(...args),
}));

const mockGetUserProfile = vi.fn();
vi.mock("../../services/users", () => ({
  getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
  // The auth-bootstrap variant shares the same spy so existing tests that
  // drive the initial sign-in path keep working without extra setup.
  getUserProfileOnAuth: (uid: string) => mockGetUserProfile(uid),
}));

const mockCaptureMessage = vi.fn();
const mockSetSentryUser = vi.fn();
vi.mock("../../lib/sentry", () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  setUser: (...args: unknown[]) => mockSetSentryUser(...args),
  // logger.ts (transitively imported) calls addBreadcrumb on every warn/error
  // emit; stub it so the mock is a complete swap, not a partial one.
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
}));

const mockIsAppCheckInitialized = vi.fn(() => false);
vi.mock("../../firebase", () => ({
  FIRESTORE_DB_NAME: "skatehubba",
  isAppCheckInitialized: () => mockIsAppCheckInitialized(),
}));

import { useAuth } from "../useAuth";

beforeEach(() => {
  vi.clearAllMocks();
  authChangeCallback = null;
});

/* ── Tests ──────────────────────────────────── */

describe("useAuth hook", () => {
  it("starts in loading state", () => {
    const { result } = renderHook(() => useAuth());
    expect(result.current.loading).toBe(true);
    expect(result.current.user).toBeNull();
    expect(result.current.profile).toBeNull();
  });

  it("sets user and profile when auth fires with a user", async () => {
    const profile = { uid: "u1", username: "sk8r", email: "a@b.com" };
    mockGetUserProfile.mockResolvedValue(profile);

    const { result } = renderHook(() => useAuth());

    // Simulate Firebase auth callback
    await act(async () => {
      authChangeCallback?.({ uid: "u1", email: "a@b.com" });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.user).toEqual({ uid: "u1", email: "a@b.com" });
      expect(result.current.profile).toEqual(profile);
    });
  });

  it("sets user and profile to null on sign-out", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1" });

    const { result } = renderHook(() => useAuth());

    // Sign in
    await act(async () => {
      authChangeCallback?.({ uid: "u1" });
    });

    // Sign out
    await act(async () => {
      authChangeCallback?.(null);
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.user).toBeNull();
      expect(result.current.profile).toBeNull();
    });
  });

  it("unsubscribes from auth on unmount", () => {
    const { unmount } = renderHook(() => useAuth());
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalled();
  });

  it("refreshProfile re-fetches the user profile", async () => {
    const profile1 = { uid: "u1", username: "sk8r" };
    const profile2 = { uid: "u1", username: "sk8r_updated" };
    mockGetUserProfile.mockResolvedValueOnce(profile1).mockResolvedValueOnce(profile2);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.({ uid: "u1" });
    });

    await waitFor(() => expect(result.current.profile).toEqual(profile1));

    await act(async () => {
      await result.current.refreshProfile();
    });

    await waitFor(() => expect(result.current.profile).toEqual(profile2));
  });

  it("sets profile to null when profile fetch fails for a new user", async () => {
    mockGetUserProfile.mockRejectedValueOnce(new Error("not found"));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.({ uid: "u1" });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.profile).toBeNull();
      expect(result.current.user).toEqual({ uid: "u1" });
    });

    // A generic Error (not a permission-denied) must NOT trigger the
    // diagnostics breadcrumb — we only want it for the App Check / rules
    // failure mode, otherwise every new-user sign-in would page Sentry.
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("emits Sentry diagnostics with App Check + DB signals on permission-denied", async () => {
    mockIsAppCheckInitialized.mockReturnValueOnce(false);
    const denied = Object.assign(new Error("Missing or insufficient permissions."), {
      code: "permission-denied",
    });
    mockGetUserProfile.mockRejectedValueOnce(denied);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.({ uid: "u-denied" });
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.profile).toBeNull();
    });

    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage).toHaveBeenCalledWith(
      "users/{uid} permission-denied after retries",
      expect.objectContaining({
        level: "error",
        extra: expect.objectContaining({
          uid: "u-denied",
          appCheckInitialized: false,
          dbName: "skatehubba",
        }),
      }),
    );
  });

  it("refreshProfile does nothing when there is no user", async () => {
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.(null);
    });

    await act(async () => {
      await result.current.refreshProfile();
    });

    expect(result.current.profile).toBeNull();
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it("refreshProfile handles null profile (new user without profile)", async () => {
    mockGetUserProfile.mockResolvedValueOnce({ uid: "u1", username: "sk8r" }).mockResolvedValueOnce(null);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.({ uid: "u1" });
    });

    await waitFor(() => expect(result.current.profile).toEqual({ uid: "u1", username: "sk8r" }));

    await act(async () => {
      await result.current.refreshProfile();
    });

    await waitFor(() => expect(result.current.profile).toBeNull());
  });

  it("reloads auth token on visibilitychange when emailVerified is false", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });
    mockReloadUser.mockResolvedValue(true);

    const { result } = renderHook(() => useAuth());

    // Sign in with an unverified user
    await act(async () => {
      authChangeCallback?.({ uid: "u1", email: "a@b.com", emailVerified: false });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Simulate returning to the tab
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockReloadUser).toHaveBeenCalled();
  });

  it("skips reload when emailVerified is already true", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    const { result } = renderHook(() => useAuth());

    // Sign in with a verified user
    await act(async () => {
      authChangeCallback?.({ uid: "u1", email: "a@b.com", emailVerified: true });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Simulate returning to the tab
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockReloadUser).not.toHaveBeenCalled();
  });

  it("ignores visibilitychange when document is hidden", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.({ uid: "u1", email: "a@b.com", emailVerified: false });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Simulate tab going hidden (not visible)
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockReloadUser).not.toHaveBeenCalled();
  });

  it("does not update user when reloadUser returns false (still unverified)", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });
    mockReloadUser.mockResolvedValue(false);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.({ uid: "u1", email: "a@b.com", emailVerified: false });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    const userBefore = result.current.user;

    // Simulate returning to the tab — still unverified
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockReloadUser).toHaveBeenCalled();
    // User object should not have changed (no re-render forced)
    expect(result.current.user).toBe(userBefore);
  });

  it("swallows errors from reloadUser on visibilitychange", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });
    mockReloadUser.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.({ uid: "u1", email: "a@b.com", emailVerified: false });
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Should not throw
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(mockReloadUser).toHaveBeenCalled();
    expect(result.current.user).toBeTruthy();
  });

  it("refreshProfile preserves existing profile on transient error", async () => {
    const profile = { uid: "u1", username: "sk8r" };
    mockGetUserProfile.mockResolvedValueOnce(profile).mockRejectedValueOnce(new Error("network error"));

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.({ uid: "u1" });
    });

    await waitFor(() => expect(result.current.profile).toEqual(profile));

    await act(async () => {
      await result.current.refreshProfile();
    });

    // Profile should still be the original value — not cleared
    expect(result.current.profile).toEqual(profile);
  });
});
