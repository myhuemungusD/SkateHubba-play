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

  it("updates user when emailVerified flips after reload on visibilitychange", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    // Start with emailVerified = false; reload() mutates the object in place
    // (matching real Firebase SDK behaviour).
    const fakeUser = { uid: "u1", emailVerified: false, reload: vi.fn() };
    fakeUser.reload.mockImplementation(async () => {
      fakeUser.emailVerified = true;
    });

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.(fakeUser);
    });

    await waitFor(() => expect(result.current.user).toBeTruthy());
    expect((result.current.user as unknown as typeof fakeUser).emailVerified).toBe(false);

    // Simulate user returning to tab after clicking the verification link
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      // Let the async reload resolve
      await vi.waitFor(() => expect(fakeUser.reload).toHaveBeenCalled());
    });

    await waitFor(() => {
      expect((result.current.user as unknown as typeof fakeUser).emailVerified).toBe(true);
    });
  });

  it("handles reload failure gracefully when checking email verification", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    const fakeUser = {
      uid: "u1",
      emailVerified: false,
      reload: vi.fn().mockRejectedValue(new Error("network error")),
    };

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.(fakeUser);
    });

    await waitFor(() => expect(result.current.user).toBeTruthy());

    // Trigger visibilitychange — reload fails but hook should not throw
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    // User stays unverified — no crash
    expect((result.current.user as unknown as typeof fakeUser).emailVerified).toBe(false);
  });

  it("does not update user when reload succeeds but email is still unverified", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    const fakeUser = {
      uid: "u1",
      emailVerified: false,
      reload: vi.fn().mockResolvedValue(undefined), // reload succeeds, but emailVerified stays false
    };

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.(fakeUser);
    });

    const userBefore = result.current.user;

    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.waitFor(() => expect(fakeUser.reload).toHaveBeenCalled());
    });

    // User reference should NOT have changed (no setUser call)
    expect(result.current.user).toBe(userBefore);
    expect((result.current.user as unknown as typeof fakeUser).emailVerified).toBe(false);
  });

  it("cleans up polling and listener on unmount while unverified", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    const fakeUser = {
      uid: "u1",
      emailVerified: false,
      reload: vi.fn().mockImplementation(async () => {
        fakeUser.emailVerified = true;
      }),
    };

    const { result, unmount } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.(fakeUser);
    });

    await waitFor(() => expect(result.current.user).toBeTruthy());

    // Reset reload mock and unmount — the cancelled flag should prevent setUser
    fakeUser.reload.mockClear();
    fakeUser.emailVerified = false;
    unmount();

    // Trigger visibilitychange after unmount — should be a no-op
    fakeUser.reload.mockImplementation(async () => {
      fakeUser.emailVerified = true;
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // reload should not be called since listener was removed
    expect(fakeUser.reload).not.toHaveBeenCalled();
  });

  it("ignores reload result after effect cleanup (cancelled)", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    let resolveReload!: () => void;
    const fakeUser = {
      uid: "u1",
      emailVerified: false,
      reload: vi.fn().mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveReload = r;
          }),
      ),
    };

    const { result, unmount } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.(fakeUser);
    });

    await waitFor(() => expect(result.current.user).toBeTruthy());

    // Trigger a reload via visibility change — reload is pending
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fakeUser.reload).toHaveBeenCalled();

    // Sign out (triggers cleanup of the effect via user changing to a new value)
    // The cancelled flag should now be set
    fakeUser.emailVerified = true;
    await act(async () => {
      authChangeCallback?.(null);
    });

    // Now resolve the pending reload — the cancelled guard should prevent setUser
    await act(async () => {
      resolveReload();
    });

    // User should be null from sign-out, not re-set by the stale reload
    expect(result.current.user).toBeNull();

    unmount();
  });

  it("ignores visibilitychange when document is hidden", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    const fakeUser = {
      uid: "u1",
      emailVerified: false,
      reload: vi.fn().mockResolvedValue(undefined),
    };

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.(fakeUser);
    });

    await waitFor(() => expect(result.current.user).toBeTruthy());

    // Fire visibilitychange with hidden state — should not trigger reload
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fakeUser.reload).not.toHaveBeenCalled();
  });

  it("polls on interval while unverified", async () => {
    vi.useFakeTimers();
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    const fakeUser = {
      uid: "u1",
      emailVerified: false,
      reload: vi.fn().mockResolvedValue(undefined),
    };

    const { result, unmount } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.(fakeUser);
    });

    // Advance past one poll interval (5s)
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });

    expect(fakeUser.reload).toHaveBeenCalledTimes(1);

    unmount();
    vi.useRealTimers();
  });

  it("does not set up polling when emailVerified is already true", async () => {
    mockGetUserProfile.mockResolvedValue({ uid: "u1", username: "sk8r" });

    const fakeUser = { uid: "u1", emailVerified: true, reload: vi.fn() };
    const { result } = renderHook(() => useAuth());

    await act(async () => {
      authChangeCallback?.(fakeUser);
    });

    await waitFor(() => expect(result.current.user).toBeTruthy());

    // Trigger visibilitychange — reload should NOT be called since already verified
    await act(async () => {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fakeUser.reload).not.toHaveBeenCalled();
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
