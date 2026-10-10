import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Firestore } from "firebase-admin/firestore";
import {
  applyGameStats,
  deriveGameStats,
  levelForXp,
  nextRecentResults,
  xpToReach,
  type ApplyGameStatsResult,
} from "./applyGameStats.js";

// Replace the real FieldValue with a deterministic sentinel so we can assert on
// the exact payload handed to tx.update without depending on admin internals.
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    increment: (by: number): { __increment: number } => ({ __increment: by }),
    serverTimestamp: (): { __serverTimestamp: true } => ({ __serverTimestamp: true }),
  },
}));

const GAME_ID = "game-1";
const P1 = "uid-p1";
const P2 = "uid-p2";
const JUDGE = "uid-judge";

const GAME_PATH = `games/${GAME_ID}`;
const P1_PATH = `users/${P1}`;
const P2_PATH = `users/${P2}`;

/**
 * Expected winner payload. `wins`/`gamesPlayed` are relative increments, while
 * the streak fields are absolute values computed from the profile snapshot —
 * so the caller states the streak it expects to land on.
 */
function winPayload(currentWinStreak: number, bestWinStreak: number): Record<string, unknown> {
  return {
    wins: { __increment: 1 },
    gamesPlayed: { __increment: 1 },
    currentWinStreak,
    bestWinStreak,
    // A game with no letters against the winner is a clean win by definition,
    // so the default payload carries it.
    cleanWins: { __increment: 1 },
    recentResults: ["W"],
  };
}

/** Expected loser payload. A loss always zeroes the run and never touches `bestWinStreak`. */
const LOSS_INCREMENT = {
  losses: { __increment: 1 },
  gamesPlayed: { __increment: 1 },
  currentWinStreak: 0,
  recentResults: ["L"],
};

/** Strip `cleanWins` from an expected winner payload (the winner took a letter). */
function notClean(payload: Record<string, unknown>): Record<string, unknown> {
  const { cleanWins: _dropped, ...rest } = payload;
  return rest;
}

interface DocRef {
  path: string;
  collection: (name: string) => { doc: (id: string) => DocRef };
}

function makeRef(path: string): DocRef {
  const ref = { path } as DocRef;
  // Non-enumerable so `toHaveBeenCalledWith({ path })` still matches. The
  // close-out only walks into a subcollection when XP is on.
  Object.defineProperty(ref, "collection", {
    enumerable: false,
    value: (name: string) => ({
      doc: (id: string) => makeRef(`${path}/${name}/${id}`),
    }),
  });
  return ref;
}

interface FakeSnap {
  exists: boolean;
  data: () => Record<string, unknown> | undefined;
}

interface TxLike {
  get: (ref: DocRef) => Promise<FakeSnap>;
  update: (ref: DocRef, data: Record<string, unknown>) => void;
  set: (ref: DocRef, data: Record<string, unknown>) => void;
}

/** path -> document data; a missing key models a non-existent doc. */
type Store = Record<string, Record<string, unknown> | undefined>;

function makeHarness(store: Store): {
  db: Firestore;
  update: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  updatedPaths: () => string[];
} {
  const update = vi.fn<(ref: DocRef, data: Record<string, unknown>) => void>();
  const set = vi.fn<(ref: DocRef, data: Record<string, unknown>) => void>();
  const get = vi.fn(async (ref: DocRef): Promise<FakeSnap> => {
    const data = store[ref.path];
    return { exists: data !== undefined, data: () => data };
  });

  const tx: TxLike = { get, update, set };

  const db = {
    collection: (name: string) => ({
      doc: (id: string): DocRef => makeRef(`${name}/${id}`),
    }),
    runTransaction: (fn: (t: TxLike) => Promise<ApplyGameStatsResult>): Promise<ApplyGameStatsResult> => fn(tx),
  };

  return {
    db: db as unknown as Firestore,
    update,
    set,
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
    // Neither profile carries streak fields yet (pre-Tier-1 docs), so the
    // winner's run starts at 1 and sets an equal best.
    expect(update).toHaveBeenCalledWith({ path: P1_PATH }, winPayload(1, 1));
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
    expect(update).toHaveBeenCalledWith({ path: P2_PATH }, winPayload(1, 1));
    // Only the abandoning side carries forfeitLosses.
    expect(update).toHaveBeenCalledWith({ path: P1_PATH }, { ...LOSS_INCREMENT, forfeitLosses: { __increment: 1 } });
  });

  // ── Tier-1 streak counters ──
  // currentWinStreak is written absolutely (not incremented) because
  // bestWinStreak has to compare against the resulting value, so these cases
  // pin the arithmetic rather than trusting a FieldValue sentinel.
  describe("win streaks", () => {
    it("extends a running streak and raises the lifetime best with it", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame(),
        [P1_PATH]: { wins: 3, losses: 1, currentWinStreak: 3, bestWinStreak: 3 },
        [P2_PATH]: { wins: 0, losses: 5 },
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith({ path: P1_PATH }, winPayload(4, 4));
    });

    it("extends a streak without disturbing a higher lifetime best", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame(),
        [P1_PATH]: { wins: 9, losses: 4, currentWinStreak: 1, bestWinStreak: 7 },
        [P2_PATH]: { wins: 0, losses: 5 },
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith({ path: P1_PATH }, winPayload(2, 7));
    });

    it("zeroes the loser's run but preserves their lifetime best", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame(),
        [P1_PATH]: { wins: 3, losses: 1 },
        [P2_PATH]: { wins: 6, losses: 5, currentWinStreak: 6, bestWinStreak: 6 },
      });

      await applyGameStats(db, GAME_ID);

      // bestWinStreak is absent from the loser payload entirely — a loss must
      // never rewrite a high-water mark.
      expect(update).toHaveBeenCalledWith({ path: P2_PATH }, LOSS_INCREMENT);
    });

    it("treats a corrupted non-numeric streak as zero instead of producing NaN", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame(),
        [P1_PATH]: { wins: 3, losses: 1, currentWinStreak: "four", bestWinStreak: null },
        [P2_PATH]: { wins: 0, losses: 5 },
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith({ path: P1_PATH }, winPayload(1, 1));
    });
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

  // ── Letter counters derived from turnHistory ──
  // These ride the same transaction + statsApplied guard as wins/losses, so the
  // assertions pin both the arithmetic and the "counted at most once" property.
  describe("letter aggregation", () => {
    /** A failed turn: `letterTo` took a letter, the other player gave it. */
    function letterTurn(letterTo: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return { turnNumber: 1, landed: false, letterTo, ...overrides };
    }

    it("credits lettersTaken to the receiver and lettersGiven to the opponent", async () => {
      const { db, update } = makeHarness({
        // P1 wins; P2 took three letters along the way.
        [GAME_PATH]: terminalGame({
          turnHistory: [letterTurn(P2), letterTurn(P2), letterTurn(P2)],
        }),
        [P1_PATH]: { wins: 3, losses: 1 },
        [P2_PATH]: { wins: 0, losses: 5 },
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith({ path: P1_PATH }, { ...winPayload(1, 1), lettersGiven: { __increment: 3 } });
      expect(update).toHaveBeenCalledWith({ path: P2_PATH }, { ...LOSS_INCREMENT, lettersTaken: { __increment: 3 } });
    });

    it("counts letters in both directions within one game", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame({
          turnHistory: [letterTurn(P2), letterTurn(P1), letterTurn(P2)],
        }),
        [P1_PATH]: {},
        [P2_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith(
        { path: P1_PATH },
        // The winner took a letter here, so this is not a clean win.
        { ...notClean(winPayload(1, 1)), lettersGiven: { __increment: 2 }, lettersTaken: { __increment: 1 } },
      );
      expect(update).toHaveBeenCalledWith(
        { path: P2_PATH },
        { ...LOSS_INCREMENT, lettersGiven: { __increment: 1 }, lettersTaken: { __increment: 2 } },
      );
    });

    it("ignores landed turns — only a failed turn moves a letter", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame({
          turnHistory: [
            { turnNumber: 1, landed: true, letterTo: null },
            { turnNumber: 2, landed: true, letterTo: P2 },
          ],
        }),
        [P1_PATH]: {},
        [P2_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      // No letter keys at all — an increment(0) would needlessly create fields.
      expect(update).toHaveBeenCalledWith({ path: P1_PATH }, winPayload(1, 1));
      expect(update).toHaveBeenCalledWith({ path: P2_PATH }, LOSS_INCREMENT);
    });

    it.each([
      ["a missing turnHistory", undefined],
      ["a non-array turnHistory", { 0: "nope" }],
      ["a string turnHistory", "corrupt"],
      ["an empty turnHistory", []],
      ["null entries", [null]],
      ["primitive entries", ["x", 7]],
      ["entries with no letterTo", [{ turnNumber: 1, landed: false }]],
      ["entries with a null letterTo", [{ turnNumber: 1, landed: false, letterTo: null }]],
      ["entries with an empty letterTo", [{ turnNumber: 1, landed: false, letterTo: "" }]],
      ["entries with a non-string letterTo", [{ turnNumber: 1, landed: false, letterTo: 12 }]],
      ["entries with a non-boolean landed", [{ turnNumber: 1, landed: "false", letterTo: P2 }]],
      ["entries with a missing landed", [{ turnNumber: 1, letterTo: P2 }]],
      ["a letterTo naming a non-participant", [{ turnNumber: 1, landed: false, letterTo: "uid-stranger" }]],
    ])("writes no letter counters for %s", async (_label, turnHistory) => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame({ turnHistory }),
        [P1_PATH]: {},
        [P2_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith({ path: P1_PATH }, winPayload(1, 1));
      expect(update).toHaveBeenCalledWith({ path: P2_PATH }, LOSS_INCREMENT);
    });

    it("never increments letters for an already-applied game (idempotency guard covers them)", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame({ statsApplied: true, turnHistory: [letterTurn(P2)] }),
        [P1_PATH]: {},
        [P2_PATH]: {},
      });

      expect(await applyGameStats(db, GAME_ID)).toBe("already-applied");
      expect(update).not.toHaveBeenCalled();
    });

    it("skips the deleted profile's letters but still credits the surviving one", async () => {
      const { db, update, updatedPaths } = makeHarness({
        [GAME_PATH]: terminalGame({ turnHistory: [letterTurn(P2), letterTurn(P1)] }),
        // Winner profile deleted.
        [P2_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      expect(updatedPaths()).not.toContain(P1_PATH);
      expect(update).toHaveBeenCalledWith(
        { path: P2_PATH },
        { ...LOSS_INCREMENT, lettersGiven: { __increment: 1 }, lettersTaken: { __increment: 1 } },
      );
    });
  });

  describe("deriveGameStats (unit)", () => {
    const ZERO = { lettersTaken: 0, lettersGiven: 0, tricksLanded: 0, tricksFailed: 0, peakLetters: 0 };

    it("returns a zeroed tally for both players when there is no history", () => {
      expect(deriveGameStats(undefined, P1, P2)).toEqual({ players: { [P1]: ZERO, [P2]: ZERO }, judgedBy: {} });
    });

    it("counts each qualifying entry exactly once", () => {
      expect(deriveGameStats([{ landed: false, letterTo: P1, matcherUid: P1 }], P1, P2)).toEqual({
        players: {
          [P1]: { ...ZERO, lettersTaken: 1, tricksFailed: 1, peakLetters: 1 },
          [P2]: { ...ZERO, lettersGiven: 1 },
        },
        judgedBy: {},
      });
    });

    it("attributes attempts to the matcher and ignores a non-participant matcher", () => {
      const history = [
        { landed: true, matcherUid: P2, judgedBy: JUDGE },
        { landed: true, matcherUid: "uid-stranger" },
        { landed: false, matcherUid: null, letterTo: P2 },
      ];

      expect(deriveGameStats(history, P1, P2)).toEqual({
        players: {
          [P1]: { ...ZERO, lettersGiven: 1 },
          [P2]: { ...ZERO, tricksLanded: 1, lettersTaken: 1, peakLetters: 1 },
        },
        judgedBy: { [JUDGE]: 1 },
      });
    });
  });

  // ── Trick attempt counters ──
  // "Landed" rows are matched attempts credited to matcherUid; the setter's own
  // set is not a separate row, so a set never shows up here.
  describe("trick attempts", () => {
    it("splits landed and failed attempts by matcher across both profiles", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame({
          turnHistory: [
            { turnNumber: 1, landed: true, matcherUid: P1, letterTo: null },
            { turnNumber: 2, landed: true, matcherUid: P2, letterTo: null },
            { turnNumber: 3, landed: false, matcherUid: P2, letterTo: P2 },
          ],
        }),
        [P1_PATH]: {},
        [P2_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith(
        { path: P1_PATH },
        { ...winPayload(1, 1), tricksLanded: { __increment: 1 }, lettersGiven: { __increment: 1 } },
      );
      expect(update).toHaveBeenCalledWith(
        { path: P2_PATH },
        {
          ...LOSS_INCREMENT,
          tricksLanded: { __increment: 1 },
          tricksFailed: { __increment: 1 },
          lettersTaken: { __increment: 1 },
        },
      );
    });
  });

  // ── Comeback wins ──
  // A comeback means the winner sat on 4+ letters (one from SKATE) and still won.
  describe("comeback wins", () => {
    it.each([
      ["4 letters against the winner", 4, true],
      ["3 letters against the winner", 3, false],
    ])("records a comeback for %s: %s", async (_label, letters, expected) => {
      const history = Array.from({ length: letters as number }, (_v, i) => ({
        turnNumber: i + 1,
        landed: false,
        letterTo: P1,
      }));
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame({ turnHistory: history }),
        [P1_PATH]: {},
        [P2_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      // No matcherUid on these rows, so only letter counters move.
      expect(update).toHaveBeenCalledWith(
        { path: P1_PATH },
        {
          ...notClean(winPayload(1, 1)),
          lettersTaken: { __increment: letters as number },
          ...(expected === true ? { comebackWins: { __increment: 1 } } : {}),
        },
      );
    });
  });

  // ── Game duration ──
  describe("total game duration", () => {
    it.each([
      ["timestamp objects", { toMillis: (): number => 1_000 }, { toMillis: (): number => 4_500 }, 3_500],
      ["raw epoch numbers", 1_000, 2_000, 1_000],
      ["Date instances", new Date(1_000), new Date(3_000), 2_000],
    ])("accumulates the span from %s", async (_label, createdAt, updatedAt, expected) => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame({ createdAt, updatedAt }),
        [P1_PATH]: {},
        [P2_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      // The denominator moves with the numerator: one game measured, one game
      // counted, so `totalGameDurationMs / gamesWithDuration` is always an
      // average over exactly the games this close-out could measure.
      const duration = {
        totalGameDurationMs: { __increment: expected as number },
        gamesWithDuration: { __increment: 1 },
      };
      expect(update).toHaveBeenCalledWith({ path: P1_PATH }, { ...winPayload(1, 1), ...duration });
      expect(update).toHaveBeenCalledWith({ path: P2_PATH }, { ...LOSS_INCREMENT, ...duration });
    });

    it.each([
      ["a missing createdAt", undefined, 5_000],
      ["a missing updatedAt", 5_000, undefined],
      ["a negative span (clock skew)", 9_000, 1_000],
      ["a zero span", 1_000, 1_000],
      ["an unresolved sentinel object", {}, 9_000],
      ["a non-finite epoch", Number.NaN, 9_000],
      // Both the numerator and its denominator drop out together — a game whose
      // span is unmeasurable must not inflate `gamesWithDuration`.
    ])("omits both duration counters for %s", async (_label, createdAt, updatedAt) => {
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame({ createdAt, updatedAt }),
        [P1_PATH]: {},
        [P2_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith({ path: P1_PATH }, winPayload(1, 1));
      expect(update).toHaveBeenCalledWith({ path: P2_PATH }, LOSS_INCREMENT);
    });
  });

  // ── Recent results ring ──
  describe("recent results", () => {
    it("appends to each profile's ring and caps it at ten entries", async () => {
      const nine = Array.from({ length: 9 }, () => "W");
      const ten = Array.from({ length: 10 }, () => "L");
      const { db, update } = makeHarness({
        [GAME_PATH]: terminalGame(),
        [P1_PATH]: { recentResults: nine },
        [P2_PATH]: { recentResults: ten },
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith({ path: P1_PATH }, { ...winPayload(1, 1), recentResults: [...nine, "W"] });
      // The oldest entry is dropped so the ring never exceeds ten.
      expect(update).toHaveBeenCalledWith(
        { path: P2_PATH },
        { ...LOSS_INCREMENT, recentResults: [...ten.slice(1), "L"] },
      );
    });

    it.each([
      ["a non-array value", "WWL"],
      ["members that are not W or L", ["W", 7, null, "X"]],
    ])("discards %s rather than propagating it", (_label, raw) => {
      expect(nextRecentResults(raw, "W")).toEqual(_label === "a non-array value" ? ["W"] : ["W", "W"]);
    });
  });

  // ── Judge credit ──
  describe("judge credit", () => {
    const JUDGE_PATH = `users/${JUDGE}`;

    function judgedGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
      return terminalGame({
        judgeId: JUDGE,
        judgeStatus: "accepted",
        turnHistory: [
          { turnNumber: 1, landed: true, matcherUid: P2, judgedBy: JUDGE },
          { turnNumber: 2, landed: true, matcherUid: P2, judgedBy: null },
        ],
        ...overrides,
      });
    }

    it("credits an accepted judge with the game and their judged turns", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: judgedGame(),
        [P1_PATH]: {},
        [P2_PATH]: {},
        [JUDGE_PATH]: { gamesJudged: 2 },
      });

      expect(await applyGameStats(db, GAME_ID)).toBe("applied");
      expect(update).toHaveBeenCalledWith(
        { path: JUDGE_PATH },
        { gamesJudged: { __increment: 1 }, turnsJudged: { __increment: 1 } },
      );
    });

    it("still credits the game when the judge reviewed no turns", async () => {
      const { db, update } = makeHarness({
        [GAME_PATH]: judgedGame({ turnHistory: [] }),
        [P1_PATH]: {},
        [P2_PATH]: {},
        [JUDGE_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      expect(update).toHaveBeenCalledWith({ path: JUDGE_PATH }, { gamesJudged: { __increment: 1 } });
    });

    it("skips gracefully when the judge profile is deleted", async () => {
      const { db, update, updatedPaths } = makeHarness({
        [GAME_PATH]: judgedGame(),
        [P1_PATH]: {},
        [P2_PATH]: {},
        // Judge user doc missing.
      });

      expect(await applyGameStats(db, GAME_ID)).toBe("applied");
      expect(updatedPaths()).not.toContain(JUDGE_PATH);
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["the invite is still pending", { judgeStatus: "pending" }],
      ["the invite was declined", { judgeStatus: "declined" }],
      ["judgeStatus is absent", { judgeStatus: undefined }],
      ["judgeId is null", { judgeId: null }],
      ["judgeId is an empty string", { judgeId: "" }],
    ])("writes no judge counters when %s", async (_label, overrides) => {
      const { db, update, updatedPaths } = makeHarness({
        [GAME_PATH]: judgedGame(overrides),
        [P1_PATH]: {},
        [P2_PATH]: {},
        [JUDGE_PATH]: {},
      });

      await applyGameStats(db, GAME_ID);

      expect(updatedPaths()).not.toContain(JUDGE_PATH);
      expect(update).toHaveBeenCalledTimes(3);
    });
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

const ON = { enabled: true, testers: "" };
const DAY = 24 * 60 * 60 * 1000;
const GAME_START = Date.UTC(2026, 5, 2, 12, 0, 0);
const GAME_END = GAME_START + 60 * 60 * 1000;
const OLD_ACCOUNT = GAME_START - 2 * DAY;

function agedProfiles(extra: Record<string, unknown> = {}): Store {
  return {
    [P1_PATH]: { wins: 0, losses: 0, createdAt: OLD_ACCOUNT, ...extra },
    [P2_PATH]: { wins: 0, losses: 0, createdAt: OLD_ACCOUNT },
  };
}

describe("xp curve pins", () => {
  it("pins level 2, level 10, and level 50", () => {
    expect(xpToReach(1)).toBe(0);
    expect(xpToReach(2)).toBe(24);
    expect(xpToReach(10)).toBe(1944);
    expect(xpToReach(50)).toBe(57624);
    expect(levelForXp(0)).toBe(1);
    expect(levelForXp(24)).toBe(2);
    expect(levelForXp(1944)).toBe(10);
    expect(levelForXp(57624)).toBe(50);
    expect(levelForXp(57625)).toBe(50);
  });
});

describe("applyGameStats xp", () => {
  it("pays finish, win, and lands, and stays off when the gate is omitted", async () => {
    const turns = [
      { landed: true, matcherUid: P1 },
      { landed: true, matcherUid: P1 },
      { landed: true, matcherUid: P1 },
      { landed: true, matcherUid: P1 },
      { landed: false, matcherUid: P2, letterTo: P2 },
      { landed: false, matcherUid: P2, letterTo: P2 },
    ];
    const { db, update, set } = makeHarness({
      [GAME_PATH]: terminalGame({
        createdAt: GAME_START,
        updatedAt: GAME_END,
        turnHistory: turns,
      }),
      ...agedProfiles(),
    });

    await applyGameStats(db, GAME_ID);
    expect(set).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ path: P1_PATH }, expect.not.objectContaining({ xp: expect.anything() }));

    const on = makeHarness({
      [GAME_PATH]: terminalGame({
        createdAt: GAME_START,
        updatedAt: GAME_END,
        turnHistory: turns,
      }),
      ...agedProfiles(),
    });
    await applyGameStats(on.db, GAME_ID, ON);
    // A: 50 finish + 50 win + 40 lands = 140. 140 is level 3 (96 to reach).
    expect(on.update).toHaveBeenCalledWith(
      { path: P1_PATH },
      expect.objectContaining({ xp: 140, level: 3, xpToday: 140, xpDay: "2026-06-02", uniqueOpponents: 1 }),
    );
    // B took letters, so this is not a clean win, and B's two misses are not lands.
    expect(on.update).toHaveBeenCalledWith(
      { path: P2_PATH },
      expect.objectContaining({ xp: 50, level: 2, uniqueOpponents: 1 }),
    );
  });

  it("pays nothing on an empty forfeit and does not touch the pair counter", async () => {
    const { db, update, set } = makeHarness({
      [GAME_PATH]: terminalGame({
        status: "forfeit",
        turnHistory: [],
        createdAt: GAME_START,
        updatedAt: GAME_END,
      }),
      ...agedProfiles(),
    });

    await applyGameStats(db, GAME_ID, ON);

    const winnerWrite = update.mock.calls.find((c) => (c[0] as DocRef).path === P1_PATH)?.[1] as Record<
      string,
      unknown
    >;
    expect(winnerWrite.xp).toBeUndefined();
    expect(set.mock.calls.some((call) => (call[0] as DocRef).path.startsWith("xpPairs"))).toBe(false);
    expect(set.mock.calls.some((call) => (call[0] as DocRef).path.includes("xpMarkers"))).toBe(false);
  });

  it("pays finish and lands on a real forfeit and does not pay the win", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({
        status: "forfeit",
        turnHistory: [
          { landed: true, matcherUid: P1 },
          { landed: true, matcherUid: P2 },
        ],
        createdAt: GAME_START,
        updatedAt: GAME_END,
      }),
      ...agedProfiles(),
    });

    await applyGameStats(db, GAME_ID, ON);

    expect(update).toHaveBeenCalledWith({ path: P1_PATH }, expect.objectContaining({ xp: 60 }));
    expect(update).toHaveBeenCalledWith({ path: P2_PATH }, expect.objectContaining({ xp: 60 }));
  });

  it("tapers the same pair across a UTC day and leaves a different day at full", async () => {
    const base = {
      createdAt: GAME_START,
      updatedAt: GAME_END,
      turnHistory: [
        { landed: true, matcherUid: P1 },
        { landed: false, matcherUid: P2, letterTo: P2 },
      ],
    };
    const second = makeHarness({
      [GAME_PATH]: terminalGame(base),
      ...agedProfiles(),
      [`xpPairs/${P1}_${P2}`]: { utcDay: "2026-06-02", count: 1 },
    });
    await applyGameStats(second.db, GAME_ID, ON);
    // 50 finish + 50 win + 10 lands = 110, halved to 55.
    expect(second.update).toHaveBeenCalledWith({ path: P1_PATH }, expect.objectContaining({ xp: 55 }));
    expect(second.set).toHaveBeenCalledWith({ path: `xpPairs/${P1}_${P2}` }, { utcDay: "2026-06-02", count: 2 });

    const fourth = makeHarness({
      [GAME_PATH]: terminalGame(base),
      ...agedProfiles(),
      [`xpPairs/${P1}_${P2}`]: { utcDay: "2026-06-02", count: 3 },
    });
    await applyGameStats(fourth.db, GAME_ID, ON);
    const winnerWrite = fourth.update.mock.calls.find((c) => (c[0] as DocRef).path === P1_PATH)?.[1] as Record<
      string,
      unknown
    >;
    expect(winnerWrite.xp).toBeUndefined();
  });

  it("drops XP above the 3000 daily cap", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({
        createdAt: GAME_START,
        updatedAt: GAME_END,
        turnHistory: [{ landed: true, matcherUid: P1 }],
      }),
      [P1_PATH]: { createdAt: OLD_ACCOUNT, xp: 5000, xpDay: "2026-06-02", xpToday: 2950, level: 8 },
      [P2_PATH]: { createdAt: OLD_ACCOUNT },
    });

    await applyGameStats(db, GAME_ID, ON);

    // 50 + 50 + 10 = 110, but only 50 fits under the cap.
    expect(update).toHaveBeenCalledWith(
      { path: P1_PATH },
      expect.objectContaining({ xp: 5050, xpToday: 3000, level: levelForXp(5050) }),
    );
  });

  it("pays no play XP when either account is younger than a day, and still pays a call", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({
        createdAt: GAME_START,
        updatedAt: GAME_END,
        judgeId: JUDGE,
        judgeStatus: "accepted",
        turnHistory: [{ landed: true, matcherUid: P1, judgedBy: JUDGE }],
      }),
      [P1_PATH]: { createdAt: GAME_START - 60 * 60 * 1000 },
      [P2_PATH]: { createdAt: OLD_ACCOUNT },
      [`users/${JUDGE}`]: { createdAt: OLD_ACCOUNT },
    });

    await applyGameStats(db, GAME_ID, ON);

    const winnerWrite = update.mock.calls.find((c) => (c[0] as DocRef).path === P1_PATH)?.[1] as Record<
      string,
      unknown
    >;
    expect(winnerWrite.xp).toBeUndefined();
    expect(update).toHaveBeenCalledWith({ path: `users/${JUDGE}` }, expect.objectContaining({ xp: 10, level: 1 }));
  });

  it("is idempotent when the gate is on", async () => {
    const { db, update, set } = makeHarness({
      [GAME_PATH]: terminalGame({ statsApplied: true, createdAt: GAME_START, updatedAt: GAME_END }),
      ...agedProfiles(),
    });

    const result = await applyGameStats(db, GAME_ID, ON);

    expect(result).toBe("already-applied");
    expect(update).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it("grants a shutout achievement once and does not grant it again", async () => {
    const { db, set } = makeHarness({
      [GAME_PATH]: terminalGame({
        createdAt: GAME_START,
        updatedAt: GAME_END,
        turnHistory: [{ landed: true, matcherUid: P1 }],
      }),
      ...agedProfiles({ cleanWins: 0 }),
    });

    await applyGameStats(db, GAME_ID, ON);

    expect(set).toHaveBeenCalledWith(
      { path: `users/${P1}/achievements/shutout_1` },
      { earnedAt: { __serverTimestamp: true }, reason: "Win a game without taking a letter." },
    );
  });

  it("lets a tester earn without paying the other player", async () => {
    const { db, update } = makeHarness({
      [GAME_PATH]: terminalGame({ createdAt: GAME_START, updatedAt: GAME_END }),
      ...agedProfiles(),
    });

    await applyGameStats(db, GAME_ID, { enabled: false, testers: P1 });

    expect(update).toHaveBeenCalledWith({ path: P1_PATH }, expect.objectContaining({ xp: 100 }));
    const loserWrite = update.mock.calls.find((c) => (c[0] as DocRef).path === P2_PATH)?.[1] as Record<string, unknown>;
    expect(loserWrite.xp).toBeUndefined();
  });
});
