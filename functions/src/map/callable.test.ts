import { describe, expect, it, vi } from "vitest";
import type { CallableRequest } from "firebase-functions/v2/https";
import type { DiceDb } from "../dice/store.js";

const perform = vi.fn();
vi.mock("firebase-functions/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("./checkin.js", async (orig) => {
  const real = await orig<typeof import("./checkin.js")>();
  return { ...real, performCheckin: (...args: unknown[]) => perform(...args) };
});

const { handleCheckinCall } = await import("./callable.js");

const body = { spotId: "s1", lat: 1, lng: 2, accuracyM: 5, clientAt: 1, clientId: "c1" };
function request(data: unknown, uid: string | null = "u1"): CallableRequest {
  return { data, auth: uid ? { uid, token: {} } : undefined, app: undefined } as unknown as CallableRequest;
}
const deps = { enabled: false, testers: "u1", xpEnabled: false, xpTesters: "u1", nowMs: 5, db: {} as DiceDb };

describe("handleCheckinCall", () => {
  it("requires auth", async () => {
    await expect(handleCheckinCall(request(body, null), deps)).rejects.toMatchObject({ code: "unauthenticated" });
  });
  it("refuses non-testers while the switch is off", async () => {
    await expect(handleCheckinCall(request(body, "x"), deps)).rejects.toMatchObject({
      code: "failed-precondition",
      message: "map_checkins_disabled",
    });
  });
  it("rejects a bad body", async () => {
    await expect(handleCheckinCall(request({}), deps)).rejects.toMatchObject({
      code: "invalid-argument",
      message: "bad_spot",
    });
  });
  it("passes the resolved XP gate and returns the result", async () => {
    perform.mockResolvedValueOnce({ code: "ok", xp: 5 });
    await expect(handleCheckinCall(request(body), { ...deps, enabled: true })).resolves.toEqual({ code: "ok", xp: 5 });
    expect(perform.mock.calls[0]?.[1]).toEqual({ uid: "u1", nowMs: 5, xpOn: true });
  });
  it("wraps unexpected failures", async () => {
    perform.mockRejectedValueOnce(new Error("boom"));
    await expect(handleCheckinCall(request(body), deps)).rejects.toMatchObject({ code: "internal" });
    perform.mockRejectedValueOnce("weird");
    await expect(handleCheckinCall(request(body), deps)).rejects.toMatchObject({ code: "internal" });
  });
});
