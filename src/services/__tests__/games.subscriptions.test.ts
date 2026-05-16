import { describe, it, expect, vi } from "vitest";

import {
  installGamesTestBeforeEach,
  baseGame,
  mockOnSnapshot,
  mockWhere,
  mockLimit,
} from "./games.test-helpers";

import { subscribeToGame, subscribeToMyGames } from "../games";

installGamesTestBeforeEach();

describe("games service", () => {
  describe("subscribeToGame", () => {
    it("calls onUpdate with the game doc on snapshot", () => {
      mockOnSnapshot.mockImplementation((_ref: unknown, cb: Function) => {
        cb({
          exists: () => true,
          id: "g1",
          data: () => ({ ...baseGame }),
        });
        return vi.fn(); // unsub
      });

      const onUpdate = vi.fn();
      subscribeToGame("g1", onUpdate);
      expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ id: "g1" }));
    });

    it("calls onUpdate with null when doc doesn't exist", () => {
      mockOnSnapshot.mockImplementation((_ref: unknown, cb: Function) => {
        cb({ exists: () => false });
        return vi.fn();
      });

      const onUpdate = vi.fn();
      subscribeToGame("g1", onUpdate);
      expect(onUpdate).toHaveBeenCalledWith(null);
    });

    it("returns an unsubscribe function", () => {
      const mockUnsub = vi.fn();
      mockOnSnapshot.mockReturnValue(mockUnsub);

      const unsub = subscribeToGame("g1", vi.fn());
      unsub();
      expect(mockUnsub).toHaveBeenCalled();
    });

    it("calls onUpdate with null on snapshot error", () => {
      mockOnSnapshot.mockImplementation((_ref: unknown, _onNext: unknown, onError: Function) => {
        onError(new Error("permission-denied"));
        return vi.fn();
      });

      const onUpdate = vi.fn();
      subscribeToGame("g1", onUpdate);
      expect(onUpdate).toHaveBeenCalledWith(null);
    });
  });

  describe("subscribeToMyGames", () => {
    it("sets up three snapshot listeners (p1, p2, and judge queries)", () => {
      mockOnSnapshot.mockReturnValue(vi.fn());

      subscribeToMyGames("u1", vi.fn());

      // Three queries: player1Uid == u1, player2Uid == u1, judgeId == u1
      expect(mockOnSnapshot).toHaveBeenCalledTimes(3);
      expect(mockWhere).toHaveBeenCalledWith("player1Uid", "==", "u1");
      expect(mockWhere).toHaveBeenCalledWith("player2Uid", "==", "u1");
      expect(mockWhere).toHaveBeenCalledWith("judgeId", "==", "u1");
    });

    it("accepts a custom limit count", () => {
      mockOnSnapshot.mockReturnValue(vi.fn());

      subscribeToMyGames("u1", vi.fn(), 10);

      expect(mockLimit).toHaveBeenCalledWith(10);
    });

    it("unsubscribes all listeners on cleanup", () => {
      const unsub1 = vi.fn();
      const unsub2 = vi.fn();
      const unsub3 = vi.fn();
      mockOnSnapshot.mockReturnValueOnce(unsub1).mockReturnValueOnce(unsub2).mockReturnValueOnce(unsub3);

      const unsub = subscribeToMyGames("u1", vi.fn());
      unsub();

      expect(unsub1).toHaveBeenCalled();
      expect(unsub2).toHaveBeenCalled();
      expect(unsub3).toHaveBeenCalled();
    });

    it("merges and deduplicates games from both queries", () => {
      const onUpdate = vi.fn();

      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        // Both queries return the same game + one unique
        cb({
          docs: [
            { id: "g1", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) },
            { id: "g2", data: () => ({ ...baseGame, status: "active", turnNumber: 2 }) },
          ],
        });
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      // Should be called with deduplicated games
      const games = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      const ids = games.map((g: { id: string }) => g.id);
      expect(new Set(ids).size).toBe(ids.length); // no duplicates
    });

    it("sorts active games before completed games", () => {
      const onUpdate = vi.fn();

      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        cb({
          docs: [
            { id: "g1", data: () => ({ ...baseGame, status: "complete", turnNumber: 5 }) },
            { id: "g2", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) },
          ],
        });
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      const games = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(games[0].status).toBe("active");
      expect(games[1].status).toBe("complete");
    });

    it("keeps active game at front when it appears first in results", () => {
      const onUpdate = vi.fn();

      // Put active game FIRST so comparator is called with (active, complete)
      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        cb({
          docs: [
            { id: "g2", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) },
            { id: "g1", data: () => ({ ...baseGame, status: "complete", turnNumber: 5 }) },
          ],
        });
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      const games = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      expect(games[0].status).toBe("active");
      expect(games[1].status).toBe("complete");
    });

    it("sorts completed games by turn number descending", () => {
      const onUpdate = vi.fn();

      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        cb({
          docs: [
            { id: "g1", data: () => ({ ...baseGame, status: "complete", turnNumber: 2 }) },
            { id: "g2", data: () => ({ ...baseGame, status: "forfeit", turnNumber: 5 }) },
          ],
        });
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      const games = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0];
      // Both are non-active, should be sorted by turnNumber descending
      expect(games[0].id).toBe("g2"); // turnNumber 5 first
      expect(games[1].id).toBe("g1"); // turnNumber 2 second
    });

    it("logs a warning on snapshot error (does not throw)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockOnSnapshot.mockImplementation((_query: unknown, _onNext: unknown, onError: Function) => {
        onError(new Error("network error"));
        return vi.fn();
      });

      // Should not throw — error is swallowed with a logger.warn
      expect(() => subscribeToMyGames("u1", vi.fn())).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        "[WARN]",
        "game_subscription_error",
        expect.objectContaining({ uid: "u1", error: "network error" }),
      );
      warnSpy.mockRestore();
    });

    /* ── H-G6 regression: gated first-load merge ────── */

    it("waits for all three listeners to seed before firing the first onUpdate", () => {
      const onUpdate = vi.fn();
      // Capture each listener's onNext so we can fire them in a staggered
      // order — simulating real-world snapshot races.
      const listeners: Array<(snap: unknown) => void> = [];
      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        listeners.push(cb as (snap: unknown) => void);
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);
      expect(listeners.length).toBe(3);

      // First listener (p1) emits — must NOT fire onUpdate yet (2 slices
      // still unseeded → partial merge would flash to the UI).
      listeners[0]({
        docs: [{ id: "g1", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) }],
      });
      expect(onUpdate).not.toHaveBeenCalled();

      // Second listener (p2) emits — still short one slice, no emit.
      listeners[1]({
        docs: [{ id: "g2", data: () => ({ ...baseGame, status: "active", turnNumber: 2 }) }],
      });
      expect(onUpdate).not.toHaveBeenCalled();

      // Third listener (judge) emits — now emit the full merged view once.
      listeners[2]({
        docs: [{ id: "g3", data: () => ({ ...baseGame, status: "active", turnNumber: 3 }) }],
      });
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const games = onUpdate.mock.calls[0][0];
      expect(games.map((g: { id: string }) => g.id).sort()).toEqual(["g1", "g2", "g3"]);
    });

    it("emits freely on every snapshot after the first-load gate opens", () => {
      const onUpdate = vi.fn();
      const listeners: Array<(snap: unknown) => void> = [];
      mockOnSnapshot.mockImplementation((_query: unknown, cb: Function) => {
        listeners.push(cb as (snap: unknown) => void);
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      // Seed all three with empty snapshots — first emit fires with 0 games.
      listeners[0]({ docs: [] });
      listeners[1]({ docs: [] });
      listeners[2]({ docs: [] });
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate.mock.calls[0][0]).toEqual([]);

      // A follow-up snapshot on any slice should emit immediately (no
      // further gating) with the new merged view.
      listeners[0]({
        docs: [{ id: "g1", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) }],
      });
      expect(onUpdate).toHaveBeenCalledTimes(2);
      expect(onUpdate.mock.calls[1][0]).toHaveLength(1);
    });

    it("treats a listener error as a seeded-but-empty slice (still opens the gate)", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onUpdate = vi.fn();
      const nextFns: Array<(snap: unknown) => void> = [];
      const errFns: Array<(err: Error) => void> = [];
      mockOnSnapshot.mockImplementation((_query: unknown, onNext: Function, onError: Function) => {
        nextFns.push(onNext as (snap: unknown) => void);
        errFns.push(onError as (err: Error) => void);
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      // Seed p1 and p2 normally, then fail the judge listener.
      nextFns[0]({
        docs: [{ id: "g1", data: () => ({ ...baseGame, status: "active", turnNumber: 1 }) }],
      });
      nextFns[1]({ docs: [] });
      expect(onUpdate).not.toHaveBeenCalled();

      errFns[2](new Error("permission-denied"));
      // The error path should clear the judge slice AND mark it seeded so the
      // healthy slices can emit. We see the game from p1 only — no stale or
      // partial data polluting the merge.
      expect(onUpdate).toHaveBeenCalledTimes(1);
      const games = onUpdate.mock.calls[0][0];
      expect(games.map((g: { id: string }) => g.id)).toEqual(["g1"]);
      warnSpy.mockRestore();
    });

    it("preserves the slice's prior state when an already-seeded listener errors", () => {
      // After first-load completes, a transient error on a seeded listener
      // must NOT zero out that slice. The Firestore SDK auto-reconnects on
      // transient errors and the next successful snapshot replaces the
      // slice atomically — zeroing here would silently empty the user's
      // view (e.g. all judge games vanish) on every flaky reconnect cycle.
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const onUpdate = vi.fn();
      const nextFns: Array<(snap: unknown) => void> = [];
      const errFns: Array<(err: Error) => void> = [];
      mockOnSnapshot.mockImplementation((_query: unknown, onNext: Function, onError: Function) => {
        nextFns.push(onNext as (snap: unknown) => void);
        errFns.push(onError as (err: Error) => void);
        return vi.fn();
      });

      subscribeToMyGames("u1", onUpdate);

      // Seed all three with data — first emit.
      nextFns[0]({ docs: [{ id: "g1", data: () => ({ ...baseGame, turnNumber: 1 }) }] });
      nextFns[1]({ docs: [{ id: "g2", data: () => ({ ...baseGame, turnNumber: 2 }) }] });
      nextFns[2]({ docs: [{ id: "g3", data: () => ({ ...baseGame, turnNumber: 3 }) }] });
      expect(onUpdate).toHaveBeenCalledTimes(1);
      expect(onUpdate.mock.calls[0][0]).toHaveLength(3);

      // Judge listener errors — slice is preserved. Merged state is
      // unchanged, so no re-emit fires (wasteful churn avoided).
      errFns[2](new Error("permission-denied"));
      expect(onUpdate).toHaveBeenCalledTimes(1);

      // A subsequent successful snapshot from the recovered listener
      // replaces the slice and emits fresh data normally.
      nextFns[2]({ docs: [{ id: "g3", data: () => ({ ...baseGame, turnNumber: 30 }) }] });
      expect(onUpdate).toHaveBeenCalledTimes(2);
      const games = onUpdate.mock.calls[1][0];
      expect(games.map((g: { id: string }) => g.id).sort()).toEqual(["g1", "g2", "g3"]);
      warnSpy.mockRestore();
    });
  });
});
