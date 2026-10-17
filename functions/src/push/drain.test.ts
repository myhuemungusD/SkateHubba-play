import { describe, expect, it, vi } from "vitest";
import { deliverDispatch, drainQueue, parseDispatchDoc, PUSH_TTL_MS, RETRY_MIN_AGE_MS } from "./drain.js";

const NOW = 1_800_000_000_000;
const ts = (ms: number) => ({ toMillis: () => ms });
const good = (over: Record<string, unknown> = {}) => ({
  tokens: ["a", "b"],
  notification: { title: "T", body: "B" },
  recipientUid: "u1",
  data: { gameId: "g", n: 5 },
  createdAt: ts(NOW - 1000),
  ...over,
});

function deps(over: Partial<Parameters<typeof deliverDispatch>[1]> = {}) {
  return {
    nowMs: NOW,
    warn: vi.fn(),
    prune: vi.fn(async () => {}),
    send: vi.fn(async () => ({ failureCount: 0, responses: [{ success: true }, { success: true }] })),
    ...over,
  };
}
const doc = (data: Record<string, unknown> | undefined, createdAtMs: number | null = NOW - 1000) => ({
  id: "d1",
  data,
  createdAtMs,
  delete: vi.fn(async () => {}),
});

describe("parseDispatchDoc", () => {
  it("parses a valid doc and drops non-string data", () => {
    expect(parseDispatchDoc(good())).toEqual({
      tokens: ["a", "b"],
      title: "T",
      body: "B",
      data: { gameId: "g" },
      recipientUid: "u1",
      createdAtMs: NOW - 1000,
    });
  });
  it("tolerates missing data and createdAt", () => {
    expect(parseDispatchDoc(good({ data: null, createdAt: "x" }))).toMatchObject({ data: {}, createdAtMs: null });
  });
  it.each([
    undefined,
    good({ tokens: "a" }),
    good({ tokens: ["", 3] }),
    good({ notification: null }),
    good({ notification: { title: 1, body: "B" } }),
    good({ recipientUid: "" }),
  ])("rejects malformed %#", (raw) => {
    expect(parseDispatchDoc(raw as Record<string, unknown> | undefined)).toBeNull();
  });
});

describe("deliverDispatch", () => {
  it("sends then deletes", async () => {
    const d = doc(good());
    const dp = deps();
    expect(await deliverDispatch(d, dp)).toBe("sent");
    expect(dp.send).toHaveBeenCalledWith({
      tokens: ["a", "b"],
      notification: { title: "T", body: "B" },
      data: { gameId: "g" },
    });
    expect(d.delete).toHaveBeenCalled();
    expect(dp.prune).not.toHaveBeenCalled();
  });
  it("deletes malformed docs unsent", async () => {
    const d = doc({});
    const dp = deps();
    expect(await deliverDispatch(d, dp)).toBe("malformed");
    expect(dp.send).not.toHaveBeenCalled();
    expect(d.delete).toHaveBeenCalled();
  });
  it("deletes expired docs unsent", async () => {
    const d = doc(good({ createdAt: ts(NOW - PUSH_TTL_MS - 1) }));
    const dp = deps();
    expect(await deliverDispatch(d, dp)).toBe("expired");
    expect(dp.send).not.toHaveBeenCalled();
  });
  it("prunes only dead tokens", async () => {
    const dp = deps({
      send: vi.fn(async () => ({
        failureCount: 2,
        responses: [
          { success: false, error: { code: "messaging/registration-token-not-registered" } },
          { success: false, error: { code: "messaging/internal-error" } },
        ],
      })),
    });
    expect(await deliverDispatch(doc(good()), dp)).toBe("sent");
    expect(dp.prune).toHaveBeenCalledWith("u1", ["a"]);
  });
  it("a prune failure still deletes the doc", async () => {
    const d = doc(good());
    const dp = deps({
      send: vi.fn(async () => ({
        failureCount: 1,
        responses: [{ success: false, error: { code: "messaging/invalid-argument" } }, { success: false }],
      })),
      prune: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    expect(await deliverDispatch(d, dp)).toBe("sent");
    expect(dp.warn).toHaveBeenCalledWith("drain_prune_failed", { recipientUid: "u1", message: "boom" });
    expect(d.delete).toHaveBeenCalled();
  });
  it("leaves the doc queued on a send failure", async () => {
    const d = doc(good());
    const dp = deps({
      send: vi.fn(async () => {
        throw "down";
      }),
    });
    expect(await deliverDispatch(d, dp)).toBe("error");
    expect(d.delete).not.toHaveBeenCalled();
    expect(dp.warn).toHaveBeenCalledWith("drain_dispatch_failed", { dispatchId: "d1", message: "down" });
  });
});

describe("drainQueue", () => {
  it("skips fresh docs and tallies outcomes", async () => {
    const old = NOW - RETRY_MIN_AGE_MS - 1;
    const dp = deps({
      send: vi.fn().mockResolvedValueOnce({ failureCount: 0, responses: [] }).mockRejectedValueOnce(new Error("x")),
    });
    const s = await drainQueue(
      [
        doc(good(), NOW - 1000),
        doc(good({ createdAt: ts(old) }), old),
        doc({}, null),
        doc(good({ createdAt: ts(NOW - PUSH_TTL_MS - 5) }), NOW - PUSH_TTL_MS - 5),
        doc(good({ createdAt: ts(old) }), old),
      ],
      dp,
    );
    expect(s).toEqual({ scanned: 5, sent: 1, expired: 1, malformed: 1, errors: 1, skippedFresh: 1 });
  });
});
