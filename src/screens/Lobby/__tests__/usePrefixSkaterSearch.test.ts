import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { UserProfile } from "../../../services/users";

const svc = vi.hoisted(() => ({ searchPlayersByPrefix: vi.fn(), getBlockedUserIds: vi.fn(), warn: vi.fn() }));
vi.mock("../../../services/playerSearch", () => ({ searchPlayersByPrefix: svc.searchPlayersByPrefix }));
vi.mock("../../../services/blocking", () => ({ getBlockedUserIds: svc.getBlockedUserIds }));
vi.mock("../../../services/logger", () => ({ logger: { warn: svc.warn } }));

import { SKATER_SEARCH_DEBOUNCE_MS, usePrefixSkaterSearch } from "../usePrefixSkaterSearch";

const p = (uid: string): UserProfile => ({ uid, username: uid, stance: "regular", createdAt: null });
const flush = () => act(async () => vi.advanceTimersByTimeAsync(SKATER_SEARCH_DEBOUNCE_MS));

beforeEach(() => {
  vi.useFakeTimers();
  svc.searchPlayersByPrefix.mockReset().mockResolvedValue([p("old")]);
  svc.getBlockedUserIds.mockReset().mockResolvedValue(new Set(["blk"]));
  svc.warn.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("usePrefixSkaterSearch", () => {
  it("does nothing for an empty query", async () => {
    const { result } = renderHook(() => usePrefixSkaterSearch("", "me"));
    await flush();
    expect(result.current).toEqual({ players: [], loading: false });
    expect(svc.searchPlayersByPrefix).not.toHaveBeenCalled();
  });

  it("debounces keystrokes and excludes the viewer and blocked skaters", async () => {
    const { result, rerender } = renderHook(({ q }) => usePrefixSkaterSearch(q, "me"), { initialProps: { q: "o" } });
    expect(result.current.loading).toBe(true);
    rerender({ q: "ol" });
    rerender({ q: "old" });
    await flush();
    expect(svc.searchPlayersByPrefix).toHaveBeenCalledTimes(1);
    expect(svc.searchPlayersByPrefix).toHaveBeenCalledWith("old", new Set(["me", "blk"]));
    expect(result.current).toEqual({ players: [p("old")], loading: false });
    rerender({ q: "olde" });
    await flush();
    expect(svc.getBlockedUserIds).toHaveBeenCalledTimes(1);
  });

  it("treats a failed block lookup as no blocks", async () => {
    svc.getBlockedUserIds.mockRejectedValueOnce(new Error("nope"));
    renderHook(() => usePrefixSkaterSearch("old", "me"));
    await flush();
    expect(svc.searchPlayersByPrefix).toHaveBeenCalledWith("old", new Set(["me"]));
  });

  it("logs and returns nothing when the search fails", async () => {
    svc.searchPlayersByPrefix.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => usePrefixSkaterSearch("old", "me"));
    await flush();
    expect(result.current).toEqual({ players: [], loading: false });
    expect(svc.warn).toHaveBeenCalledWith("skater_prefix_search_failed", { error: "offline" });
  });

  it("logs non-Error failures too", async () => {
    svc.searchPlayersByPrefix.mockRejectedValueOnce("boom");
    renderHook(() => usePrefixSkaterSearch("old", "me"));
    await flush();
    expect(svc.warn).toHaveBeenCalledWith("skater_prefix_search_failed", { error: "boom" });
  });

  it("ignores a result that lands after unmount", async () => {
    let resolve: (v: UserProfile[]) => void = () => {};
    svc.searchPlayersByPrefix.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const { unmount } = renderHook(() => usePrefixSkaterSearch("old", "me"));
    await flush();
    unmount();
    await act(async () => resolve([p("late")]));
    expect(svc.warn).not.toHaveBeenCalled();
  });

  it("ignores a failure that lands after unmount", async () => {
    let reject: (e: Error) => void = () => {};
    svc.searchPlayersByPrefix.mockReturnValueOnce(new Promise((_r, j) => (reject = j)));
    const { unmount } = renderHook(() => usePrefixSkaterSearch("old", "me"));
    await flush();
    unmount();
    await act(async () => reject(new Error("late")));
    expect(svc.warn).toHaveBeenCalledTimes(1);
  });
});
