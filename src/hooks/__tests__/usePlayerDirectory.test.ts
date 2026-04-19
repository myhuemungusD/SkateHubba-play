import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const mockGetPlayerDirectory = vi.fn();
const mockGetBlockedUserIds = vi.fn();
const mockLoggerWarn = vi.fn();

vi.mock("../../services/users", () => ({
  getPlayerDirectory: (...args: unknown[]) => mockGetPlayerDirectory(...args),
}));

vi.mock("../../services/blocking", () => ({
  getBlockedUserIds: (...args: unknown[]) => mockGetBlockedUserIds(...args),
}));

vi.mock("../../services/logger", () => ({
  logger: {
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
  },
}));

import { usePlayerDirectory } from "../usePlayerDirectory";

const mkProfile = (uid: string, username: string) => ({
  uid,
  username,
  stance: "Regular",
  createdAt: null,
  emailVerified: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetBlockedUserIds.mockResolvedValue(new Set<string>());
});

describe("usePlayerDirectory", () => {
  it("starts in loading state", () => {
    mockGetPlayerDirectory.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => usePlayerDirectory("u1"));
    expect(result.current.loading).toBe(true);
    expect(result.current.players).toEqual([]);
  });

  it("filters out the viewer and blocked users", async () => {
    mockGetPlayerDirectory.mockResolvedValue([
      mkProfile("u1", "self"),
      mkProfile("u2", "other"),
      mkProfile("u3", "blocked"),
    ]);
    mockGetBlockedUserIds.mockResolvedValue(new Set(["u3"]));

    const { result } = renderHook(() => usePlayerDirectory("u1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.players).toHaveLength(1);
    expect(result.current.players[0].uid).toBe("u2");
  });

  it("returns empty list and logs on fetch failure", async () => {
    mockGetPlayerDirectory.mockRejectedValue(new Error("network"));

    const { result } = renderHook(() => usePlayerDirectory("u1"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.players).toEqual([]);
    expect(mockLoggerWarn).toHaveBeenCalled();
  });

  it("ignores stale responses after unmount", async () => {
    let resolveFn!: (v: unknown[]) => void;
    mockGetPlayerDirectory.mockReturnValue(
      new Promise((r) => {
        resolveFn = r;
      }),
    );

    const { result, unmount } = renderHook(() => usePlayerDirectory("u1"));
    unmount();

    await act(async () => {
      resolveFn([mkProfile("u2", "other")]);
    });

    // No assertion throws — the setState on the unmounted hook is a no-op because
    // the cleanup ran. `result.current` still reflects the initial state.
    expect(result.current.players).toEqual([]);
  });

  it("ignores stale responses after viewerUid changes", async () => {
    let resolveFirst!: (v: unknown[]) => void;
    mockGetPlayerDirectory.mockReturnValueOnce(
      new Promise((r) => {
        resolveFirst = r;
      }),
    );

    const { result, rerender } = renderHook(({ uid }) => usePlayerDirectory(uid), {
      initialProps: { uid: "u1" },
    });

    // Second fetch for u2 resolves immediately with a single user
    mockGetPlayerDirectory.mockResolvedValueOnce([mkProfile("u3", "three")]);
    rerender({ uid: "u2" });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.players[0].uid).toBe("u3");

    // Now resolve the stale u1 fetch with different data — it should be ignored.
    await act(async () => {
      resolveFirst([mkProfile("u1", "one"), mkProfile("u9", "nine")]);
    });

    expect(result.current.players[0].uid).toBe("u3");
  });

  it("ignores stale rejections after viewerUid changes", async () => {
    let rejectFirst!: (err: Error) => void;
    mockGetPlayerDirectory.mockReturnValueOnce(
      new Promise((_r, rej) => {
        rejectFirst = rej;
      }),
    );

    const { result, rerender } = renderHook(({ uid }) => usePlayerDirectory(uid), {
      initialProps: { uid: "u1" },
    });

    mockGetPlayerDirectory.mockResolvedValueOnce([mkProfile("u3", "three")]);
    rerender({ uid: "u2" });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      rejectFirst(new Error("stale"));
    });

    // Players for u2 should remain intact
    expect(result.current.players[0].uid).toBe("u3");
  });
});
