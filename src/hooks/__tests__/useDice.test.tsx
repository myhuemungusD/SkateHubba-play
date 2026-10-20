import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DiceGameDoc, DiceStatsDoc } from "../../services/dice";
import { toDiceStats } from "../../services/dice.mappers";
import { diceGame } from "../../__tests__/harness/diceFixtures";

const subs = vi.hoisted(() => ({
  games: vi.fn(),
  stats: vi.fn(),
  game: vi.fn(),
}));

vi.mock("../../services/dice", async () => ({
  subscribeToMyDiceGames: (...args: unknown[]) => subs.games(...args),
  subscribeToDiceStats: (...args: unknown[]) => subs.stats(...args),
  subscribeToDiceGame: (...args: unknown[]) => subs.game(...args),
  toDiceStats: (await import("../../services/dice.mappers")).toDiceStats,
}));

import { useDiceGame, useDiceStats, useMyDiceGames } from "../useDice";

const MATCH: DiceGameDoc = diceGame({ round: 4, rollCount: 7 });

describe("useMyDiceGames", () => {
  beforeEach(() => {
    subs.games.mockReset().mockReturnValue(vi.fn());
    subs.stats.mockReset().mockReturnValue(vi.fn());
  });

  it("stays empty without a uid and does not subscribe", () => {
    const { result } = renderHook(() => useMyDiceGames(null));
    expect(result.current.loading).toBe(false);
    expect(result.current.games).toEqual([]);
    expect(result.current.stats).toEqual(toDiceStats(undefined));
    expect(result.current.error).toBe(false);
    expect(subs.games).not.toHaveBeenCalled();
  });

  it("publishes games and stats, then clears them when the uid goes away", () => {
    let onGames: (games: DiceGameDoc[]) => void = () => {};
    let onStats: (stats: DiceStatsDoc) => void = () => {};
    const unsub = vi.fn();
    subs.games.mockImplementation((_uid: string, next: typeof onGames) => {
      onGames = next;
      return unsub;
    });
    subs.stats.mockImplementation((_uid: string, next: typeof onStats) => {
      onStats = next;
      return vi.fn();
    });
    const { result, rerender } = renderHook(({ uid }: { uid: string | null }) => useMyDiceGames(uid), {
      initialProps: { uid: "u1" as string | null },
    });
    expect(result.current.loading).toBe(true);
    act(() => {
      onGames([MATCH]);
      onStats({ ...toDiceStats(undefined), wins: 2, losses: 1, gamesPlayed: 3 });
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.games).toEqual([MATCH]);
    expect(result.current.stats.wins).toBe(2);
    rerender({ uid: null });
    expect(unsub).toHaveBeenCalled();
    expect(result.current.games).toEqual([]);
    expect(result.current.stats.wins).toBe(0);
  });

  it("reports a listener error and retries with a fresh listener", () => {
    let onError: () => void = () => {};
    let onGames: (games: DiceGameDoc[]) => void = () => {};
    subs.games.mockImplementation((_uid: string, next: typeof onGames, err: () => void) => {
      onError = err;
      onGames = next;
      return vi.fn();
    });
    const { result } = renderHook(() => useMyDiceGames("u1"));
    act(() => onError());
    expect(result.current.error).toBe(true);
    expect(result.current.loading).toBe(false);
    act(() => result.current.retry());
    expect(subs.games).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(true);
    act(() => {
      onGames([MATCH]);
      const statsCb = subs.stats.mock.calls[0]?.[1] as (stats: DiceStatsDoc) => void;
      statsCb(toDiceStats(undefined));
    });
    expect(result.current.loading).toBe(false);
    expect(result.current.games).toEqual([MATCH]);
  });
});

describe("useDiceStats", () => {
  beforeEach(() => {
    subs.stats.mockReset().mockReturnValue(vi.fn());
  });

  it("defaults without a uid, then shows the live record", () => {
    let onStats: (stats: DiceStatsDoc) => void = () => {};
    subs.stats.mockImplementation((_uid: string, next: typeof onStats) => {
      onStats = next;
      return vi.fn();
    });
    const { result, rerender } = renderHook(({ uid }: { uid: string | null }) => useDiceStats(uid), {
      initialProps: { uid: null as string | null },
    });
    expect(result.current.rep).toBe(1000);
    expect(subs.stats).not.toHaveBeenCalled();
    rerender({ uid: "u1" });
    act(() => onStats({ ...toDiceStats(undefined), rep: 1040 }));
    expect(result.current.rep).toBe(1040);
  });
});

describe("useDiceGame", () => {
  beforeEach(() => {
    subs.game.mockReset().mockReturnValue(vi.fn());
  });

  it("is idle without a game id", () => {
    const { result } = renderHook(() => useDiceGame(undefined));
    expect(result.current).toEqual({ game: null, loading: false, missing: false });
    expect(subs.game).not.toHaveBeenCalled();
  });

  it("treats an empty id the same as a missing one", () => {
    const { result } = renderHook(() => useDiceGame(""));
    expect(result.current.loading).toBe(false);
    expect(subs.game).not.toHaveBeenCalled();
  });

  it("marks the match missing when the listener returns null or errors", () => {
    let onGame: (game: DiceGameDoc | null) => void = () => {};
    let onError: () => void = () => {};
    subs.game.mockImplementation((_id: string, next: typeof onGame, err: () => void) => {
      onGame = next;
      onError = err;
      return vi.fn();
    });
    const { result, rerender } = renderHook(({ id }: { id: string | undefined }) => useDiceGame(id), {
      initialProps: { id: "g1" as string | undefined },
    });
    act(() => onGame(MATCH));
    expect(result.current.game?.id).toBe("g1");
    expect(result.current.missing).toBe(false);
    act(() => onGame(null));
    expect(result.current.missing).toBe(true);
    rerender({ id: "g2" });
    act(() => onError());
    expect(result.current.missing).toBe(true);
    expect(result.current.loading).toBe(false);
    rerender({ id: undefined });
    expect(result.current.game).toBeNull();
    expect(result.current.missing).toBe(false);
  });
});
