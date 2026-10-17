import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWttFeed } from "../useWttFeed";
import type { WttItem, WttReliability } from "../../services/wtt.types";

const mockFetchWttItems = vi.fn();
const mockSubmitWttVote = vi.fn();
const mockFetchWttReliability = vi.fn();

vi.mock("../../services/wtt", () => ({
  fetchWttItems: (...args: unknown[]) => mockFetchWttItems(...args),
  submitWttVote: (...args: unknown[]) => mockSubmitWttVote(...args),
  fetchWttReliability: (...args: unknown[]) => mockFetchWttReliability(...args),
}));

const mockItem1: WttItem = {
  clipId: "clip1",
  trickFamily: "kickflip",
  options: ["kickflip", "heelflip", "impossible", "bigflip"],
  status: "open",
  voteCount: 2,
  weightedTally: {},
  top: null,
  topPosterior: 0,
  createdAt: new Date(),
};

const mockItem2: WttItem = {
  clipId: "clip2",
  trickFamily: "heelflip",
  options: ["heelflip", "kickflip", "varial-heelflip", "hardflip"],
  status: "open",
  voteCount: 1,
  weightedTally: {},
  top: null,
  topPosterior: 0,
  createdAt: new Date(),
};

const mockReliability: WttReliability = {
  reliability: { kickflip: 0.85 },
  goldSeen: 0,
  goldCorrect: 0,
  trickIq: 85,
  streakDays: 3,
  lastAnsweredDay: null,
  freezesLeft: 2,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchWttItems.mockResolvedValue([mockItem1, mockItem2]);
  mockFetchWttReliability.mockResolvedValue(mockReliability);
  mockSubmitWttVote.mockResolvedValue(undefined);
});

describe("useWttFeed", () => {
  it("loads initial items and reliability on mount", async () => {
    const { result } = renderHook(() => useWttFeed("user123"));

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(mockFetchWttItems).toHaveBeenCalledWith("user123", 10);
    expect(mockFetchWttReliability).toHaveBeenCalledWith("user123");
    expect(result.current.items).toHaveLength(2);
    expect(result.current.currentItem).toEqual(mockItem1);
    expect(result.current.reliability).toEqual(mockReliability);
  });

  it("handles loading errors", async () => {
    mockFetchWttItems.mockRejectedValue(new Error("Load failed"));

    const { result } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.error?.message).toBe("Load failed");
  });

  it("submits answer and advances to next item", async () => {
    const { result } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currentItem?.clipId).toBe("clip1");

    await act(async () => {
      await result.current.submitAnswer("kickflip");
    });

    expect(mockSubmitWttVote).toHaveBeenCalledWith("clip1", "user123", "kickflip");
    expect(result.current.currentItem?.clipId).toBe("clip2");
    expect(result.current.dailyCount).toBe(1);
  });

  it("skips to next item without submitting", async () => {
    const { result } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.currentItem?.clipId).toBe("clip1");

    act(() => {
      result.current.skipCurrent();
    });

    expect(mockSubmitWttVote).not.toHaveBeenCalled();
    expect(result.current.currentItem?.clipId).toBe("clip2");
    expect(result.current.dailyCount).toBe(0);
  });

  it("loads more items when queue is low", async () => {
    mockFetchWttItems.mockResolvedValueOnce([mockItem1]).mockResolvedValueOnce([mockItem2]);

    const { result } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(mockFetchWttItems).toHaveBeenCalledTimes(2);
  });

  it("returns null currentItem when all items exhausted", async () => {
    mockFetchWttItems.mockResolvedValueOnce([mockItem1]).mockResolvedValue([]);

    const { result } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.currentItem?.clipId).toBe("clip1");

    await act(async () => {
      await result.current.submitAnswer("kickflip");
    });

    await waitFor(() => {
      expect(result.current.currentItem).toBeNull();
    });
  });

  it("tracks daily limit", async () => {
    const { result } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dailyLimit).toBe(20);
    expect(result.current.dailyCount).toBe(0);

    await act(async () => {
      await result.current.submitAnswer("kickflip");
    });

    expect(result.current.dailyCount).toBe(1);
  });

  it("handles submit errors gracefully", async () => {
    mockSubmitWttVote.mockRejectedValue(new Error("Submit failed"));

    const { result } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await expect(result.current.submitAnswer("kickflip")).rejects.toThrow("Submit failed");
    });

    expect(result.current.currentItem?.clipId).toBe("clip1");
  });

  it("cleans up on unmount", async () => {
    const { unmount } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(mockFetchWttItems).toHaveBeenCalled();
    });

    unmount();
  });

  it("sets daily count from goldSeen when lastAnsweredDay is today", async () => {
    const today = new Date().toISOString().split("T")[0];
    mockFetchWttReliability.mockResolvedValue({
      ...mockReliability,
      goldSeen: 5,
      lastAnsweredDay: today,
    });

    const { result } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.dailyCount).toBe(5);
  });

  it("handles loadMore errors gracefully", async () => {
    mockFetchWttItems.mockResolvedValueOnce([mockItem1]).mockRejectedValueOnce(new Error("Load more failed"));

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { result } = renderHook(() => useWttFeed("user123"));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    await act(async () => {
      await result.current.loadMore();
    });

    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });

  it("ignores a load that resolves after unmount", async () => {
    let resolve!: (v: WttItem[]) => void;
    mockFetchWttItems.mockReturnValueOnce(new Promise<WttItem[]>((r) => (resolve = r)));
    const { result, unmount } = renderHook(() => useWttFeed("user123"));
    unmount();
    await act(async () => {
      resolve([mockItem1]);
    });
    expect(result.current.items).toEqual([]);
  });

  it("ignores a load that rejects after unmount", async () => {
    let reject!: (e: unknown) => void;
    mockFetchWttItems.mockReturnValueOnce(new Promise<WttItem[]>((_, r) => (reject = r)));
    const { result, unmount } = renderHook(() => useWttFeed("user123"));
    unmount();
    await act(async () => {
      reject(new Error("late"));
    });
    expect(result.current.error).toBeNull();
  });

  it("wraps a non-Error load failure", async () => {
    mockFetchWttItems.mockRejectedValueOnce("nope");
    const { result } = renderHook(() => useWttFeed("user123"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error?.message).toBe("Failed to load WTT items");
  });

  it("leaves the daily count at zero with no stats or a stale day", async () => {
    mockFetchWttReliability.mockResolvedValueOnce(null);
    const first = renderHook(() => useWttFeed("user123"));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(first.result.current.dailyCount).toBe(0);

    mockFetchWttReliability.mockResolvedValueOnce({ ...mockReliability, goldSeen: 5, lastAnsweredDay: "2000-01-01" });
    const second = renderHook(() => useWttFeed("user456"));
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.dailyCount).toBe(0);
  });

  it("does nothing when submitting with no current item", async () => {
    mockFetchWttItems.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useWttFeed("user123"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.submitAnswer("kickflip");
    });
    expect(mockSubmitWttVote).not.toHaveBeenCalled();
  });

  it("skips loadMore while the queue is still full", async () => {
    mockFetchWttItems.mockResolvedValueOnce([mockItem1, mockItem2, mockItem1, mockItem2, mockItem1]);
    const { result } = renderHook(() => useWttFeed("user123"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockFetchWttItems.mockClear();
    await act(async () => {
      await result.current.loadMore();
    });
    expect(mockFetchWttItems).not.toHaveBeenCalled();
  });

  it("stays idle and never fetches when disabled", () => {
    const { result } = renderHook(() => useWttFeed("user123", false));
    expect(result.current.loading).toBe(false);
    expect(mockFetchWttItems).not.toHaveBeenCalled();
    expect(mockFetchWttReliability).not.toHaveBeenCalled();
  });
});
