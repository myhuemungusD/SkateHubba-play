import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { handleDiceCall, type DiceCallDeps } from "./callable.js";
import { DiceActionError } from "./handlers.js";
import type { DiceDb } from "./store.js";

vi.mock("firebase-functions/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const createDiceGame = vi.fn();
const rollDice = vi.fn();
const quitDice = vi.fn();
const declineDice = vi.fn();
const claimDiceTimeout = vi.fn();
const acceptDice = vi.fn();
const bankDice = vi.fn();
const nudgeDice = vi.fn();
const rematchDice = vi.fn();

vi.mock("./handlers.js", () => ({
  createDiceGame: (...args: unknown[]) => createDiceGame(...args),
  rollDice: (...args: unknown[]) => rollDice(...args),
  quitDice: (...args: unknown[]) => quitDice(...args),
  declineDice: (...args: unknown[]) => declineDice(...args),
  claimDiceTimeout: (...args: unknown[]) => claimDiceTimeout(...args),
  acceptDice: (...args: unknown[]) => acceptDice(...args),
  bankDice: (...args: unknown[]) => bankDice(...args),
  nudgeDice: (...args: unknown[]) => nudgeDice(...args),
  rematchDice: (...args: unknown[]) => rematchDice(...args),
  DiceActionError: class DiceActionError extends Error {
    constructor(readonly code: string) {
      super(code);
      this.name = "DiceActionError";
    }
  },
}));

const db = {} as DiceDb;

function deps(overrides: Partial<DiceCallDeps> = {}): DiceCallDeps {
  return { enabled: true, testers: "", nowMs: 10, db, ...overrides };
}

function request(overrides: Record<string, unknown> = {}): CallableRequest {
  return {
    auth: { uid: "u1", token: { email_verified: true } },
    data: { action: "roll", gameId: "g1" },
    app: undefined,
    ...overrides,
  } as unknown as CallableRequest;
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpsError);
    return (err as HttpsError).message;
  }
  throw new Error("expected a throw");
}

describe("handleDiceCall", () => {
  beforeEach(() => {
    createDiceGame.mockReset();
    rollDice.mockReset();
    quitDice.mockReset();
    declineDice.mockReset();
    claimDiceTimeout.mockReset();
    acceptDice.mockReset();
    bankDice.mockReset();
    nudgeDice.mockReset();
    rematchDice.mockReset();
  });

  it("rejects a signed-out caller", async () => {
    expect(await codeOf(() => handleDiceCall(request({ auth: undefined }), deps()))).toBe("unauthenticated");
  });

  it("rejects everyone while the kill switch is off and the allowlist is empty", async () => {
    expect(await codeOf(() => handleDiceCall(request(), deps({ enabled: false, testers: "  " })))).toBe(
      "dice_disabled",
    );
  });

  it("lets an allowlisted tester through while the switch is off", async () => {
    rollDice.mockResolvedValue({ gameId: "g1", status: "active" });
    const result = await handleDiceCall(request(), deps({ enabled: false, testers: "other, u1" }));
    expect(result).toEqual({ gameId: "g1", status: "active" });
    expect(rollDice).toHaveBeenCalledOnce();
  });

  it("rejects a missing or unknown action", async () => {
    expect(await codeOf(() => handleDiceCall(request({ data: null }), deps()))).toBe("bad_request");
    expect(await codeOf(() => handleDiceCall(request({ data: { action: "bet" } }), deps()))).toBe("bad_request");
    expect(await codeOf(() => handleDiceCall(request({ data: { action: "create" } }), deps()))).toBe("bad_request");
    expect(await codeOf(() => handleDiceCall(request({ data: { action: "quit", gameId: "" } }), deps()))).toBe(
      "bad_request",
    );
  });

  it("dispatches each action", async () => {
    createDiceGame.mockResolvedValue({ gameId: "new" });
    quitDice.mockResolvedValue({ gameId: "g1" });
    declineDice.mockResolvedValue({ gameId: "g1" });
    claimDiceTimeout.mockResolvedValue({ gameId: "g1" });
    await handleDiceCall(request({ data: { action: "create", opponentUid: "u2" } }), deps());
    await handleDiceCall(request({ data: { action: "quit", gameId: "g1" } }), deps());
    await handleDiceCall(request({ data: { action: "decline", gameId: "g1" } }), deps());
    await handleDiceCall(request({ data: { action: "claimTimeout", gameId: "g1" } }), deps());
    expect(createDiceGame).toHaveBeenCalledOnce();
    expect(quitDice).toHaveBeenCalledOnce();
    expect(declineDice).toHaveBeenCalledOnce();
    expect(claimDiceTimeout).toHaveBeenCalledOnce();
  });

  it("dispatches accept, bank, nudge and rematch, and forwards mode, target and keep", async () => {
    for (const fn of [acceptDice, bankDice, nudgeDice, rematchDice, rollDice, createDiceGame]) fn.mockResolvedValue({});
    await handleDiceCall(request({ data: { action: "accept", gameId: "g1" } }), deps());
    await handleDiceCall(request({ data: { action: "bank", gameId: "g1", keep: [0, 2] } }), deps());
    await handleDiceCall(request({ data: { action: "nudge", gameId: "g1" } }), deps());
    await handleDiceCall(request({ data: { action: "rematch", gameId: "g1" } }), deps());
    await handleDiceCall(request({ data: { action: "roll", gameId: "g1", keep: [1] } }), deps());
    await handleDiceCall(request({ data: { action: "create", opponentUid: "u2", mode: "ten", target: 5000 } }), deps());
    expect(acceptDice).toHaveBeenCalledWith(db, expect.objectContaining({ uid: "u1" }), "g1");
    expect(bankDice).toHaveBeenCalledWith(db, expect.anything(), "g1", [0, 2]);
    expect(nudgeDice).toHaveBeenCalledOnce();
    expect(rematchDice).toHaveBeenCalledOnce();
    expect(rollDice).toHaveBeenCalledWith(db, expect.anything(), "g1", [1]);
    expect(createDiceGame).toHaveBeenCalledWith(db, expect.anything(), "u2", { mode: "ten", target: 5000 });
  });

  it("rejects a malformed keep list", async () => {
    expect(
      await codeOf(() => handleDiceCall(request({ data: { action: "roll", gameId: "g1", keep: "0" } }), deps())),
    ).toBe("bad_request");
    expect(
      await codeOf(() => handleDiceCall(request({ data: { action: "bank", gameId: "g1", keep: [0.5] } }), deps())),
    ).toBe("bad_request");
    expect(
      await codeOf(() =>
        handleDiceCall(request({ data: { action: "bank", gameId: "g1", keep: [0, 1, 2, 3, 4, 5, 6] } }), deps()),
      ),
    ).toBe("bad_request");
    rollDice.mockResolvedValue({});
    await handleDiceCall(request({ data: { action: "roll", gameId: "g1", keep: null } }), deps());
    expect(rollDice).toHaveBeenCalledWith(db, expect.anything(), "g1", []);
  });

  it("maps action errors onto callable codes", async () => {
    rollDice.mockRejectedValue(new DiceActionError("not_a_player"));
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("not_a_player");
    rollDice.mockRejectedValue(new DiceActionError("not_found"));
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("not_found");
    rollDice.mockRejectedValue(new DiceActionError("self_challenge"));
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("self_challenge");
    rollDice.mockRejectedValue(new DiceActionError("bad_keep"));
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("bad_keep");
    rollDice.mockRejectedValue(new DiceActionError("slow_down"));
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("slow_down");
  });

  it("hides unexpected failures", async () => {
    rollDice.mockRejectedValue(new Error("boom"));
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("dice_failed");
    rollDice.mockRejectedValue("nope");
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("dice_failed");
  });
});
