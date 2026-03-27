import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mockGetUserProfile = vi.fn();
const mockFetchPlayerCompletedGames = vi.fn();

vi.mock("../../services/users", () => ({
  getUserProfile: (...args: unknown[]) => mockGetUserProfile(...args),
}));

vi.mock("../../services/games", () => ({
  fetchPlayerCompletedGames: (...args: unknown[]) => mockFetchPlayerCompletedGames(...args),
}));

import { usePlayerProfile } from "../usePlayerProfile";

const fakeProfile = {
  uid: "u1",
  username: "alice",
  stance: "goofy",
  createdAt: null,
  emailVerified: true,
  wins: 3,
  losses: 1,
};

const fakeGames = [
  { id: "g1", status: "complete", winner: "u1" },
  { id: "g2", status: "forfeit", winner: "u2" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("usePlayerProfile", () => {
  it("skips fetch and returns not-loading when uid is empty", async () => {
    const { result } = renderHook(() => usePlayerProfile(""));
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.profile).toBeNull();
    expect(result.current.games).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(mockGetUserProfile).not.toHaveBeenCalled();
    expect(mockFetchPlayerCompletedGames).not.toHaveBeenCalled();
  });

  it("starts in loading state", () => {
    mockGetUserProfile.mockReturnValue(new Promise(() => {})); // never resolves
    mockFetchPlayerCompletedGames.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => usePlayerProfile("u1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.profile).toBeNull();
    expect(result.current.games).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it("loads profile and games successfully", async () => {
    mockGetUserProfile.mockResolvedValue(fakeProfile);
    mockFetchPlayerCompletedGames.mockResolvedValue(fakeGames);

    const { result } = renderHook(() => usePlayerProfile("u1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.profile).toEqual(fakeProfile);
    expect(result.current.games).toEqual(fakeGames);
    expect(result.current.error).toBeNull();
    expect(mockGetUserProfile).toHaveBeenCalledWith("u1");
    expect(mockFetchPlayerCompletedGames).toHaveBeenCalledWith("u1", undefined);
  });

  it("sets error when profile is not found", async () => {
    mockGetUserProfile.mockResolvedValue(null);
    mockFetchPlayerCompletedGames.mockResolvedValue([]);

    const { result } = renderHook(() => usePlayerProfile("unknown"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Player not found");
    expect(result.current.profile).toBeNull();
    expect(result.current.games).toEqual([]);
  });

  it("sets error on fetch failure", async () => {
    mockGetUserProfile.mockRejectedValue(new Error("network error"));
    mockFetchPlayerCompletedGames.mockRejectedValue(new Error("network error"));

    const { result } = renderHook(() => usePlayerProfile("u1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe("Could not load player profile");
  });

  it("refetches when uid changes", async () => {
    mockGetUserProfile.mockResolvedValue(fakeProfile);
    mockFetchPlayerCompletedGames.mockResolvedValue(fakeGames);

    const { result, rerender } = renderHook(({ uid }) => usePlayerProfile(uid), {
      initialProps: { uid: "u1" },
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(mockGetUserProfile).toHaveBeenCalledWith("u1");

    const profile2 = { ...fakeProfile, uid: "u2", username: "bob" };
    mockGetUserProfile.mockResolvedValue(profile2);
    mockFetchPlayerCompletedGames.mockResolvedValue([]);

    rerender({ uid: "u2" });

    await waitFor(() => {
      expect(result.current.profile?.uid).toBe("u2");
    });
    expect(mockGetUserProfile).toHaveBeenCalledWith("u2");
    expect(mockFetchPlayerCompletedGames).toHaveBeenCalledWith("u2", undefined);
  });

  it("ignores stale error responses when uid changes quickly", async () => {
    // First call rejects slowly
    let rejectFirst: (e: Error) => void;
    mockGetUserProfile.mockReturnValueOnce(
      new Promise((_r, rej) => {
        rejectFirst = rej;
      }),
    );
    mockFetchPlayerCompletedGames.mockResolvedValueOnce([]);

    const { result, rerender } = renderHook(({ uid }) => usePlayerProfile(uid), {
      initialProps: { uid: "u1" },
    });

    // Switch to u2 before u1 rejects
    const profile2 = { ...fakeProfile, uid: "u2", username: "bob" };
    mockGetUserProfile.mockResolvedValueOnce(profile2);
    mockFetchPlayerCompletedGames.mockResolvedValueOnce([]);
    rerender({ uid: "u2" });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Now reject the stale u1 response — should be ignored
    rejectFirst!(new Error("stale error"));

    // Profile should be u2, not an error
    expect(result.current.profile?.uid).toBe("u2");
    expect(result.current.error).toBeNull();
  });

  it("ignores stale responses when uid changes quickly", async () => {
    // First call resolves slowly
    let resolveFirst: (v: unknown) => void;
    mockGetUserProfile.mockReturnValueOnce(
      new Promise((r) => {
        resolveFirst = r;
      }),
    );
    mockFetchPlayerCompletedGames.mockResolvedValueOnce([]);

    const { result, rerender } = renderHook(({ uid }) => usePlayerProfile(uid), {
      initialProps: { uid: "u1" },
    });

    // Switch to u2 before u1 resolves
    const profile2 = { ...fakeProfile, uid: "u2", username: "bob" };
    mockGetUserProfile.mockResolvedValueOnce(profile2);
    mockFetchPlayerCompletedGames.mockResolvedValueOnce([]);
    rerender({ uid: "u2" });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // Now resolve the stale u1 response
    resolveFirst!(fakeProfile);

    // Profile should be u2, not u1
    expect(result.current.profile?.uid).toBe("u2");
  });
});
