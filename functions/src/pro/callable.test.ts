import { describe, expect, it, vi } from "vitest";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { handleBlessingCall, type BlessingCallDeps } from "./callable.js";
import { DEFAULT_BLESSING_CONFIG } from "./rules.js";
import type { DiceDb } from "../dice/store.js";

vi.mock("firebase-functions/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
const bless = vi.fn();
const respond = vi.fn();
const revoke = vi.fn();
vi.mock("./handlers.js", () => ({
  blessSkater: (...a: unknown[]) => bless(...a),
  respondToBlessing: (...a: unknown[]) => respond(...a),
  revokePro: (...a: unknown[]) => revoke(...a),
  BlessingError: class BlessingError extends Error {
    constructor(readonly code: string) {
      super(code);
    }
  },
}));

const deps = (o: Partial<BlessingCallDeps> = {}): BlessingCallDeps => ({
  enabled: true,
  testers: "",
  nowMs: 1,
  db: {} as DiceDb,
  config: DEFAULT_BLESSING_CONFIG,
  ...o,
});
const req = (data: unknown, token: Record<string, unknown> = { email_verified: true }, uid: string | null = "u1") =>
  ({ auth: uid ? { uid, token } : undefined, data }) as unknown as CallableRequest;

async function code(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpsError);
    return (err as HttpsError).message;
  }
  throw new Error("expected failure");
}

describe("handleBlessingCall", () => {
  it("requires auth and the kill switch (testers allowed)", async () => {
    expect(await code(() => handleBlessingCall(req({}, {}, null), deps()))).toBe("unauthenticated");
    const off = deps({ enabled: false });
    expect(await code(() => handleBlessingCall(req({ action: "bless", targetUid: "t" }), off))).toBe(
      "blessing_disabled",
    );
    bless.mockResolvedValueOnce({ blessingId: "b", status: "pending" });
    await handleBlessingCall(
      req({ action: "bless", targetUid: "t", reason: "r" }),
      deps({ enabled: false, testers: "x, u1" }),
    );
    expect(bless).toHaveBeenCalled();
  });

  it("routes accept/decline and validates ids", async () => {
    respond.mockResolvedValue({ blessingId: "b", status: "accepted" });
    await handleBlessingCall(req({ action: "accept", blessingId: "b" }), deps());
    await handleBlessingCall(req({ action: "decline", blessingId: "b" }), deps());
    expect(respond.mock.calls.map((c) => c[3])).toEqual([true, false]);
    expect(await code(() => handleBlessingCall(req({ action: "accept", blessingId: "a/b" }), deps()))).toBe(
      "bad_request",
    );
    expect(await code(() => handleBlessingCall(req({ action: "nope" }), deps()))).toBe("bad_request");
  });

  it("revoke needs the admin claim, even with the switch off", async () => {
    expect(await code(() => handleBlessingCall(req({ action: "revoke", targetUid: "t" }), deps()))).toBe("not_admin");
    revoke.mockResolvedValueOnce({ blessingId: "", status: "revoked" });
    await handleBlessingCall(
      req({ action: "revoke", targetUid: "t", reason: "r" }, { admin: true }),
      deps({ enabled: false }),
    );
    expect(revoke).toHaveBeenCalled();
  });

  it("maps domain errors and hides unknown ones", async () => {
    const { BlessingError } = await import("./handlers.js");
    bless.mockRejectedValueOnce(new BlessingError("limit_reached"));
    await expect(handleBlessingCall(req({ action: "bless", targetUid: "t" }), deps())).rejects.toMatchObject({
      code: "resource-exhausted",
    });
    bless.mockRejectedValueOnce(new Error("boom"));
    expect(await code(() => handleBlessingCall(req({ action: "bless", targetUid: "t" }), deps()))).toBe(
      "blessing_failed",
    );
  });
});
