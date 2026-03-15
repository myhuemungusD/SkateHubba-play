import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

/* ── mock services ──────────────────────────── */
let authChangeCallback: ((user: unknown) => void) | null = null;
const mockUnsubscribe = vi.fn();

vi.mock("../../services/auth", () => ({
  onAuthChange: vi.fn((cb: (user: unknown) => void) => {
    authChangeCallback = cb;
    return mockUnsubscribe;
  }),
}));

const mockGetUserProfile = vi.fn();
vi.mock("../../services/users", () => ({
  getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
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
