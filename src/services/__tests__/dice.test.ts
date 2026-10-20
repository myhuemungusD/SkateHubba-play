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

const net = vi.hoisted(() => ({ online: true }));
vi.mock("../nativeBridge", () => ({ getNetworkSnapshot: () => net.online }));

import {
  acceptDice,
  bankDice,
  claimDiceTimeout,
  createDiceGame,
  declineDice,
  createCooldownLine,
  diceErrorCode,
  diceErrorInfo,
  diceErrorMessage,
  nudgeDice,
  quitDice,
  rematchDice,
  rollDice,
  subscribeToDiceGame,
  subscribeToDiceStats,
  subscribeToMyDiceGames,
} from "../dice";
import { toDiceStats } from "../dice.mappers";

const RESULT = {
  gameId: "g1",
  status: "active",
  label: "Point 5",
  outcome: "point",
  callout: null,
  dice: [2, 2, 5],
  rollId: "r1",
  currentTurn: "u2",
  scores: { u1: 0, u2: 0 },
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
    lastRoll: { uid: "u1", dice: [2, 2, 5], outcome: "point", label: "Point 5" },
    ...overrides,
  };
}

describe("dice errors", () => {
  it("maps known callable messages and hides the rest", () => {
    expect(diceErrorCode(new Error("slow_down"))).toBe("slow_down");
    expect(diceErrorMessage(new Error("email_unverified"))).toBe("Verify your email first.");
    expect(diceErrorCode("nope")).toBe("dice_failed");
    expect(diceErrorCode(null)).toBe("dice_failed");
    expect(diceErrorCode({ message: 404, code: 7 })).toBe("dice_failed");
    expect(diceErrorMessage(new Error("boom"))).toBe("Something went wrong at the table. Try again.");
  });

  // Regression: the SDK reports the server's code as "slow_down [400]", which
  // never matched, so every rejection showed the generic line.
  it("reads the code from a real callable error, status suffix and all", async () => {
    const { FunctionsError } = await vi.importActual<typeof import("firebase/functions")>("firebase/functions");
    const rejected = (message: string, details?: unknown) =>
      new FunctionsError("failed-precondition", `${message} [400]`, details);
    expect(diceErrorCode(rejected("slow_down"))).toBe("slow_down");
    expect(diceErrorMessage(rejected("bad_keep"))).toBe("Those dice changed. Pick your scoring dice again.");
    expect(diceErrorMessage(rejected("not_your_turn"))).toBe("It's their roll now.");
    expect(diceErrorCode(rejected("whatever", { code: "game_over" }))).toBe("game_over");
  });

  it("says how long the create and nudge cooldowns have left", async () => {
    const { FunctionsError } = await vi.importActual<typeof import("firebase/functions")>("firebase/functions");
    const cool = (code: string, retryAfterMs: unknown) =>
      new FunctionsError("failed-precondition", `${code} [400]`, { code, retryAfterMs });
    expect(diceErrorMessage(cool("create_cooldown", 6_200))).toBe("You just started a match. Try again in 7s.");
    expect(diceErrorInfo(cool("create_cooldown", 6_200))).toEqual({ code: "create_cooldown", retryAfterMs: 6_200 });
    expect(diceErrorMessage(cool("create_cooldown", "soon"))).toBe(
      "You just started a match. Try again in a few seconds.",
    );
    expect(diceErrorMessage(cool("nudge_cooldown", 125_000))).toBe("You already nudged. Try again in 3 min.");
    expect(diceErrorMessage(cool("nudge_cooldown", 0))).toBe("You already nudged. Try again in a bit.");
    expect(createCooldownLine(200)).toBe("You just started a match. Try again in 1s.");
  });

  it("words transport failures instead of the generic line", async () => {
    const { FunctionsError } = await vi.importActual<typeof import("firebase/functions")>("firebase/functions");
    expect(diceErrorMessage(new FunctionsError("unavailable", "unavailable"))).toBe(
      "Couldn't reach the table. Check your signal and try again.",
    );
    expect(diceErrorCode(new FunctionsError("deadline-exceeded", "deadline-exceeded"))).toBe("network");
    expect(diceErrorCode(new FunctionsError("unauthenticated", "x"))).toBe("unauthenticated");
    expect(diceErrorCode(new FunctionsError("internal", "internal"))).toBe("dice_failed");
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
    expect(onUpdate).toHaveBeenNthCalledWith(1, expect.objectContaining({ wins: 1, losses: 2, gamesPlayed: 3 }));
    expect(onUpdate).toHaveBeenNthCalledWith(2, toDiceStats(undefined));
    expect(onUpdate).toHaveBeenLastCalledWith(toDiceStats(undefined));
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
    expect(trackEvent).toHaveBeenCalledWith("dice_challenge_created", { gameId: "g1", mode: "clo" });
    expect(trackEvent).toHaveBeenCalledWith("dice_rolled", { gameId: "g1" });
    expect(fns.connectFunctionsEmulator).not.toHaveBeenCalled();
    expect(addBreadcrumb).toHaveBeenCalled();
  });

  it("sends the mode, target and keep list the server expects", async () => {
    fns.callable.mockResolvedValue({ data: RESULT });
    await createDiceGame("u2", "ten", 10000);
    expect(fns.callable).toHaveBeenLastCalledWith({ action: "create", opponentUid: "u2", mode: "ten", target: 10000 });
    await rollDice("g1", [0, 2]);
    expect(fns.callable).toHaveBeenLastCalledWith({ action: "roll", gameId: "g1", keep: [0, 2] });
    await bankDice("g1", [1]);
    expect(fns.callable).toHaveBeenLastCalledWith({ action: "bank", gameId: "g1", keep: [1] });
    await acceptDice("g1");
    expect(fns.callable).toHaveBeenLastCalledWith({ action: "accept", gameId: "g1" });
    await nudgeDice("g1");
    expect(fns.callable).toHaveBeenLastCalledWith({ action: "nudge", gameId: "g1" });
    fns.callable.mockResolvedValueOnce({ data: { ...RESULT, gameId: "g2", status: "pending" } });
    await rematchDice("g1");
    expect(trackEvent).toHaveBeenCalledWith("dice_rematch", { gameId: "g2" });
    expect(trackEvent).toHaveBeenCalledWith("dice_banked", { gameId: "g1" });
    expect(trackEvent).toHaveBeenCalledWith("dice_challenge_accepted", { gameId: "g1" });
  });

  it("fails fast while offline without calling the server", async () => {
    net.online = false;
    await expect(rollDice("g1")).rejects.toThrow("offline");
    expect(fns.callable).not.toHaveBeenCalled();
    expect(diceErrorMessage(new Error("offline"))).toBe("You're offline. Reconnect to roll.");
    net.online = true;
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
    fns.callable.mockResolvedValueOnce({ data: { ...RESULT, status: "pending" } });
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
