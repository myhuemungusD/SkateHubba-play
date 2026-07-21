import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import { applyGameStats, type ApplyGameStatsResult } from "./applyGameStats.js";

// Replace the real FieldValue with a deterministic sentinel so we can assert on
// the exact payload handed to tx.update without depending on admin internals.
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (by: number): { __increment: number } => ({ __increment: by }),
  },
}));

const GAME_ID = "game-1";
const P1 = "uid-p1";
const P2 = "uid-p2";

const GAME_PATH = `games/${GAME_ID}`;
const P1_PATH = `users/${P1}`;
const P2_PATH = `users/${P2}`;

const WIN_INCREMENT = { wins: { __increment: 1 } };
const LOSS_INCREMENT = { losses: { __increment: 1 } };

interface DocRef {
  path: string;
}

interface FakeSnap {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

interface TxLike {
  get: (ref: DocRef) => Promise<FakeSnap>;
  update: (ref: DocRef, data: Record<string, unknown>) => void;
}

/** path -> document data; a missing key models a non-existent doc. */
type Store = Record<string, Record<string, unknown> | undefined>;

function makeHarness(store: Store): {
  db: Firestore;
  update: ReturnType<typeof vi.fn>;
  updatedPaths: () => string[];
} {
  const update = vi.fn<(ref: DocRef, data: Record<string, unknown>) => void>();
  const get = vi.fn(async (ref: DocRef): Promise<FakeSnap> => {
    const data = store[ref.path];
    return { exists: data !== undefined, data: () => data };
  });

  const tx: TxLike = { get, update };

  const db = {
    collection: (name: string) => ({
      doc: (id: string): DocRef => ({ path: `${name}/${id}` }),
    }),
    runTransaction: (fn: (t: TxLike) => Promise<ApplyGameStatsResult>): Promise<ApplyGameStatsResult> => fn(tx),
  };

  return {
    db: db as unknown as Firestore,
    update,
    updatedPaths: () => update.mock.calls.map(([ref]) => (ref as DocRef).path),
  };
}

function terminalGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { player1Uid: P1, player2Uid: P2, status: "complete", winner: P1, statsApplied: false, ...overrides };
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("applyGameStats", () => {
  it("applies once: sets the flag and increments both participants", async () => {
    const { db, update, updatedPaths } = makeHarness({
      [GAME_PATH]: terminalGame(),
      [P1_PATH]: { wins: 3, losses: 1 },
      [P2_PATH]: { wins: 0, losses: 5 },
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("applied");
    expect(update).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledWith({ path: GAME_PATH }, { statsApplied: true });
    expect(update).toHaveBeenCalledWith({ path: P1_PATH }, WIN_INCREMENT);
    expect(update).toHaveBeenCalledWith({ path: P2_PATH }, LOSS_INCREMENT);
    // Flag write precedes the counter writes (reads-before-writes ordering).
    expect(updatedPaths()[0]).toBe(GAME_PATH);
  });

  it("counts a forfeit exactly like a complete, resolving the loser from player2 winner", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({ status: "forfeit", winner: P2 }),
      [P1_PATH]: { wins: 1, losses: 1 },
      [P2_PATH]: { wins: 1, losses: 1 },
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("applied");
    expect(update).toHaveBeenCalledWith({ path: GAME_PATH }, { statsApplied: true });
    expect(update).toHaveBeenCalledWith({ path: P2_PATH }, WIN_INCREMENT);
    expect(update).toHaveBeenCalledWith({ path: P1_PATH }, LOSS_INCREMENT);
  });

  it("is idempotent: already-applied games perform zero writes", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({ statsApplied: true }),
      [P1_PATH]: { wins: 3, losses: 1 },
      [P2_PATH]: { wins: 0, losses: 5 },
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("already-applied");
    expect(update).not.toHaveBeenCalled();
  });

  it("skips non-terminal games without writing", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({ status: "active" }),
      [P1_PATH]: { wins: 0, losses: 0 },
      [P2_PATH]: { wins: 0, losses: 0 },
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("not-terminal");
    expect(update).not.toHaveBeenCalled();
  });

  it("skips terminal games with a null winner without writing", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({ winner: null }),
      [P1_PATH]: { wins: 0, losses: 0 },
      [P2_PATH]: { wins: 0, losses: 0 },
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("no-winner");
    expect(update).not.toHaveBeenCalled();
  });

  it("treats an empty-string winner as no winner", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({ winner: "" }),
      [P1_PATH]: { wins: 0, losses: 0 },
      [P2_PATH]: { wins: 0, losses: 0 },
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("no-winner");
    expect(update).not.toHaveBeenCalled();
  });

  it("does NOT set the flag when the winner is not a participant (integrity signal stays visible)", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({ winner: "uid-stranger" }),
      [P1_PATH]: { wins: 0, losses: 0 },
      [P2_PATH]: { wins: 0, losses: 0 },
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("winner-not-participant");
    expect(update).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("still seals the flag and increments the loser when the winner profile is deleted", async () => {
    const { db, update, updatedPaths } = makeHarness({
      [GAME_PATH]: terminalGame(),
      // P1 (winner) profile deleted; only P2 (loser) exists.
      [P2_PATH]: { wins: 0, losses: 5 },
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("applied");
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledWith({ path: GAME_PATH }, { statsApplied: true });
    expect(update).toHaveBeenCalledWith({ path: P2_PATH }, LOSS_INCREMENT);
    expect(updatedPaths()).not.toContain(P1_PATH);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("still seals the flag when both profiles are deleted, incrementing neither", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame(),
      // Both user docs missing.
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("applied");
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({ path: GAME_PATH }, { statsApplied: true });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("returns 'missing' when the game doc no longer exists", async () => {
    const { db, update } = makeHarness({
      // No game doc in the store.
      [P1_PATH]: { wins: 0, losses: 0 },
      [P2_PATH]: { wins: 0, losses: 0 },
    });

    const result = await applyGameStats(db, GAME_ID);

    expect(result).toBe("missing");
    expect(update).not.toHaveBeenCalled();
  });
});
