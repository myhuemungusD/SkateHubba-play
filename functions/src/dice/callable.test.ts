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

vi.mock("./handlers.js", () => ({
  createDiceGame: (...args: unknown[]) => createDiceGame(...args),
  rollDice: (...args: unknown[]) => rollDice(...args),
  quitDice: (...args: unknown[]) => quitDice(...args),
  declineDice: (...args: unknown[]) => declineDice(...args),
  claimDiceTimeout: (...args: unknown[]) => claimDiceTimeout(...args),
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

  it("maps action errors onto callable codes", async () => {
    rollDice.mockRejectedValue(new DiceActionError("not_a_player"));
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("not_a_player");
    rollDice.mockRejectedValue(new DiceActionError("not_found"));
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("not_found");
    rollDice.mockRejectedValue(new DiceActionError("self_challenge"));
    expect(await codeOf(() => handleDiceCall(request(), deps()))).toBe("self_challenge");
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
