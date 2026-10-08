import { beforeEach, describe, expect, it, vi } from "vitest";
import * as firebase from "../../firebase";
import { requireDb } from "../../firebase";
import { trackEvent } from "../analytics";
import { addBreadcrumb, captureException } from "../../lib/sentry";
import { logger } from "../logger";

const fns = vi.hoisted(() => {
  const callable = vi.fn();
  return {
    callable,
    getFunctions: vi.fn(() => ({ region: "us-central1" })),
    httpsCallable: vi.fn(() => callable),
    connectFunctionsEmulator: vi.fn(),
  };
});

const snaps = vi.hoisted(() => ({
  onSnapshot: vi.fn(),
}));

vi.mock("../../firebase");
vi.mock("../analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../../lib/sentry", () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("firebase/functions", () => ({
  getFunctions: fns.getFunctions,
  httpsCallable: fns.httpsCallable,
  connectFunctionsEmulator: fns.connectFunctionsEmulator,
}));
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => "col"),
  doc: vi.fn((_db: unknown, col: string, id: string) => ({ col, id })),
  query: vi.fn(() => "query"),
  where: vi.fn(),
  orderBy: vi.fn(),
  limit: vi.fn(),
  onSnapshot: (...args: unknown[]) => snaps.onSnapshot(...args),
}));

import {
  claimDiceTimeout,
  createDiceGame,
  declineDice,
  diceErrorCode,
  diceErrorMessage,
  quitDice,
  rollDice,
  subscribeToDiceGame,
  subscribeToDiceStats,
  subscribeToMyDiceGames,
  toDiceGame,
  toDiceStats,
} from "../dice";

const RESULT = {
  gameId: "g1",
  status: "active",
  label: "POINT 5",
  currentTurn: "u2",
  roundsWon: { u1: 0, u2: 0 },
  winner: null,
  applied: true,
};

function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    player1Uid: "u1",
    player2Uid: "u2",
    player1Username: "kit",
    player2Username: "fox",
    status: "active",
    currentTurn: "u1",
    round: 2,
    roundsWon: { u1: 1, u2: 0 },
    rollCount: 3,
    winner: "u1",
    endReason: "quit",
    updatedAt: 10,
    turnDeadline: 20,
    lastRoll: { uid: "u1", dice: [2, 2, 5], outcome: "point", label: "POINT 5" },
    ...overrides,
  };
}

describe("dice mappers", () => {
  it.each(["active", "forfeit", "declined", "expired"] as const)("reads a %s match", (status) => {
    const game = toDiceGame("g1", raw({ status }));
    expect(game?.status).toBe(status);
    expect(game?.lastRoll?.dice).toEqual([2, 2, 5]);
    expect(game?.roundsWon).toEqual({ u1: 1, u2: 0 });
  });

  it.each(["quit", "timeout", "decline"] as const)("reads a %s ending", (endReason) => {
    expect(toDiceGame("g1", raw({ endReason }))?.endReason).toBe(endReason);
  });

  it("drops a document that is not a match", () => {
    expect(toDiceGame("g1", undefined)).toBeNull();
    expect(toDiceGame("g1", raw({ player1Uid: "" }))).toBeNull();
    expect(toDiceGame("g1", raw({ player1Uid: 1 }))).toBeNull();
    expect(toDiceGame("g1", raw({ player2Uid: "" }))).toBeNull();
    expect(toDiceGame("g1", raw({ status: "complete" }))).toBeNull();
  });

  it("defaults missing optional fields", () => {
    const game = toDiceGame(
      "g1",
      raw({
        player1Username: 1,
        currentTurn: 4,
        round: "two",
        roundsWon: null,
        rollCount: Number.NaN,
        winner: null,
        endReason: "nope",
        updatedAt: "x",
        turnDeadline: undefined,
        lastRoll: null,
      }),
    );
    expect(game).toMatchObject({
      player1Username: "",
      currentTurn: null,
      round: 1,
      roundsWon: { u1: 0, u2: 0 },
      rollCount: 0,
      winner: null,
      endReason: null,
      updatedAt: 0,
      turnDeadline: 0,
      lastRoll: null,
    });
  });

  it("ignores a last roll that is not three numbers", () => {
    expect(toDiceGame("g1", raw({ lastRoll: { dice: [1, 2] } }))?.lastRoll).toBeNull();
    expect(toDiceGame("g1", raw({ lastRoll: { dice: [1, 2, "6"] } }))?.lastRoll).toBeNull();
    expect(toDiceGame("g1", raw({ lastRoll: "nope" }))?.lastRoll).toBeNull();
  });

  it("reads lifetime dice stats, including a missing doc", () => {
    expect(toDiceStats(undefined)).toEqual({ wins: 0, losses: 0, gamesPlayed: 0 });
    expect(toDiceStats({ wins: 2, losses: "no", gamesPlayed: 3 })).toEqual({ wins: 2, losses: 0, gamesPlayed: 3 });
  });
});

describe("dice errors", () => {
  it("maps known callable messages and hides the rest", () => {
    expect(diceErrorCode(new Error("slow_down"))).toBe("slow_down");
    expect(diceErrorMessage(new Error("email_unverified"))).toBe("Verify your email first.");
    expect(diceErrorCode("nope")).toBe("dice_failed");
    expect(diceErrorMessage(new Error("boom"))).toBe("That didn't work. Try again.");
  });
});

function resetDiceFirebase(): void {
  vi.mocked(requireDb).mockClear();
  Object.defineProperty(firebase, "isEmulatorMode", { value: false, writable: true, configurable: true });
}

describe("dice subscriptions", () => {
  beforeEach(() => {
    resetDiceFirebase();
    snaps.onSnapshot.mockReset();
    vi.mocked(logger.warn).mockClear();
  });

  it("lists the caller's matches and skips a bad doc", () => {
    const onUpdate = vi.fn();
    snaps.onSnapshot.mockImplementation((_q: unknown, next: (snap: unknown) => void) => {
      next({
        docs: [
          { id: "good", data: () => raw() },
          { id: "bad", data: () => ({ status: "nope" }) },
        ],
      });
      return vi.fn();
    });
    subscribeToMyDiceGames("u1", onUpdate);
    expect(onUpdate).toHaveBeenCalledWith([expect.objectContaining({ id: "good" })]);
  });

  it("reports a list error, including a non-Error", () => {
    const onError = vi.fn();
    snaps.onSnapshot.mockImplementation((_q: unknown, _next: unknown, err: (e: unknown) => void) => {
      err(new Error("net"));
      err("down");
      return vi.fn();
    });
    subscribeToMyDiceGames("u1", vi.fn(), onError);
    expect(onError).toHaveBeenCalledTimes(2);
    subscribeToMyDiceGames("u1", vi.fn());
  });

  it("returns a no-op unsubscribe when Firestore is not ready", () => {
    vi.mocked(requireDb).mockImplementationOnce(() => {
      throw new Error("no db");
    });
    const onError = vi.fn();
    const unsub = subscribeToMyDiceGames("u1", vi.fn(), onError);
    unsub();
    expect(onError).toHaveBeenCalled();
    vi.mocked(requireDb).mockImplementationOnce(() => {
      throw "x";
    });
    expect(subscribeToDiceGame("g1", vi.fn())).toEqual(expect.any(Function));
  });

  it("emits the game, null when it is gone, and null for a bad doc", () => {
    const onUpdate = vi.fn();
    snaps.onSnapshot.mockImplementation((_ref: unknown, next: (snap: unknown) => void) => {
      next({ id: "g1", exists: () => true, data: () => raw() });
      next({ id: "g1", exists: () => false, data: () => undefined });
      next({ id: "g1", exists: () => true, data: () => ({ status: "nope" }) });
      return vi.fn();
    });
    const unsub = subscribeToDiceGame("g1", onUpdate);
    unsub();
    expect(onUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ id: "g1" }));
    expect(onUpdate).toHaveBeenNthCalledWith(2, null);
    expect(onUpdate).toHaveBeenNthCalledWith(3, null);
  });

  it("logs a game listener error", () => {
    snaps.onSnapshot.mockImplementation((_ref: unknown, _next: unknown, err: (e: unknown) => void) => {
      err(new Error("denied"));
      err("denied");
      return vi.fn();
    });
    const onError = vi.fn();
    subscribeToDiceGame("g1", vi.fn(), onError);
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("reads dice stats and falls back to zeros", () => {
    const onUpdate = vi.fn();
    snaps.onSnapshot.mockImplementation((_ref: unknown, next: (snap: unknown) => void, err: (e: unknown) => void) => {
      next({ exists: () => true, data: () => ({ wins: 1, losses: 2, gamesPlayed: 3 }) });
      next({ exists: () => false, data: () => undefined });
      err(new Error("net"));
      err("net");
      return vi.fn();
    });
    subscribeToDiceStats("u1", onUpdate);
    expect(onUpdate).toHaveBeenNthCalledWith(1, { wins: 1, losses: 2, gamesPlayed: 3 });
    expect(onUpdate).toHaveBeenNthCalledWith(2, { wins: 0, losses: 0, gamesPlayed: 0 });
    expect(onUpdate).toHaveBeenLastCalledWith({ wins: 0, losses: 0, gamesPlayed: 0 });
  });
});

describe("dice callable", () => {
  beforeEach(() => {
    resetDiceFirebase();
    fns.callable.mockReset();
    fns.connectFunctionsEmulator.mockClear();
    fns.getFunctions.mockClear();
    vi.mocked(trackEvent).mockClear();
    vi.mocked(captureException).mockClear();
    vi.mocked(addBreadcrumb).mockClear();
    Object.defineProperty(firebase, "isEmulatorMode", { value: false, writable: true, configurable: true });
  });

  it("creates, rolls, and records the events", async () => {
    fns.callable.mockResolvedValue({ data: RESULT });
    await expect(createDiceGame("u2")).resolves.toEqual(RESULT);
    await expect(rollDice("g1")).resolves.toEqual(RESULT);
    expect(trackEvent).toHaveBeenCalledWith("dice_challenge_created", { gameId: "g1" });
    expect(trackEvent).toHaveBeenCalledWith("dice_rolled", { gameId: "g1" });
    expect(fns.connectFunctionsEmulator).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalled();
  });

  it("connects the functions emulator in emulator mode", async () => {
    Object.defineProperty(firebase, "isEmulatorMode", { value: true, writable: true, configurable: true });
    fns.callable.mockResolvedValue({ data: RESULT });
    await rollDice("g1");
    expect(fns.connectFunctionsEmulator).toHaveBeenCalledWith({ region: "us-central1" }, "127.0.0.1", 5001);
  });

  it("records a completion only when the match ended", async () => {
    fns.callable.mockResolvedValueOnce({ data: { ...RESULT, status: "forfeit" } });
    await quitDice("g1");
    fns.callable.mockResolvedValueOnce({ data: { ...RESULT, status: "declined" } });
    await declineDice("g1");
    fns.callable.mockResolvedValueOnce({ data: RESULT });
    await claimDiceTimeout("g1");
    expect(trackEvent).toHaveBeenCalledWith("dice_game_completed", { gameId: "g1", status: "forfeit" });
    expect(trackEvent).toHaveBeenCalledWith("dice_game_completed", { gameId: "g1", status: "declined" });
    expect(trackEvent).not.toHaveBeenCalledWith("dice_game_completed", { gameId: "g1", status: "active" });
  });

  it("rejects a response that is not a dice result", async () => {
    fns.callable.mockResolvedValueOnce({ data: null });
    await expect(rollDice("g1")).rejects.toThrow("bad response");
    fns.callable.mockResolvedValueOnce({ data: "nope" });
    await expect(rollDice("g1")).rejects.toThrow("bad response");
    fns.callable.mockResolvedValueOnce({ data: { gameId: 1, status: "active" } });
    await expect(rollDice("g1")).rejects.toThrow("bad response");
    fns.callable.mockResolvedValueOnce({ data: { gameId: "g1" } });
    await expect(rollDice("g1")).rejects.toThrow("bad response");
    expect(captureException).toHaveBeenCalled();
    expect(trackEvent).not.toHaveBeenCalled();
  });

  it("logs and rethrows a callable failure, including a non-Error", async () => {
    fns.callable.mockRejectedValueOnce(new Error("blocked"));
    await expect(createDiceGame("u2")).rejects.toThrow("blocked");
    fns.callable.mockRejectedValueOnce("down");
    await expect(rollDice("g1")).rejects.toBe("down");
    expect(captureException).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Firebase never initialized", async () => {
    const previous = Object.getOwnPropertyDescriptor(firebase, "default");
    Object.defineProperty(firebase, "default", { configurable: true, get: () => null });
    await expect(rollDice("g1")).rejects.toThrow("Firebase not initialized");
    if (previous) Object.defineProperty(firebase, "default", previous);
  });
});
