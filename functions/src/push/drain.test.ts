import { describe, expect, it, vi } from "vitest";
import {
  deliverDispatch,
  drainQueue,
  parseDispatchDoc,
  PUSH_BACKLOG_CUTOFF_MS,
  PUSH_TTL_MS,
  RETRY_MIN_AGE_MS,
} from "./drain.js";

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
    pushTarget: vi.fn(async (): Promise<Record<string, unknown> | undefined> => undefined),
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
  it("returns null tokens for a doc that names none (resolve from pushTargets)", () => {
    const { tokens: _omit, ...rest } = good();
    expect(parseDispatchDoc(rest)).toMatchObject({ tokens: null, recipientUid: "u1" });
  });
  it.each([
    undefined,
    good({ tokens: "a" }),
    good({ tokens: [] }),
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
      webpush: {
        fcmOptions: { link: "https://skatehubba.com/?game=g" },
        notification: { icon: "/icon-192.png", badge: "/icon-192.png", tag: "game_g", renotify: true },
      },
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
  it("drops the pre-go-live backlog unsent", async () => {
    const d = doc(good({ createdAt: ts(PUSH_BACKLOG_CUTOFF_MS - 1) }));
    const dp = deps({ nowMs: PUSH_BACKLOG_CUTOFF_MS + 60_000 });
    expect(await deliverDispatch(d, dp)).toBe("expired");
    expect(dp.send).not.toHaveBeenCalled();
    expect(d.delete).toHaveBeenCalled();
  });
  it("still delivers docs created at or after the cutoff", async () => {
    const d = doc(good({ createdAt: ts(PUSH_BACKLOG_CUTOFF_MS) }));
    const dp = deps({ nowMs: PUSH_BACKLOG_CUTOFF_MS + 60_000 });
    expect(await deliverDispatch(d, dp)).toBe("sent");
    expect(dp.send).toHaveBeenCalled();
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

describe("dice pushes and the iOS build", () => {
  const dice = (over: Record<string, unknown> = {}) =>
    good({ tokens: ["iphone", "laptop", "legacy"], data: { gameId: "g", kind: "dice", type: "dice_turn" }, ...over });
  const mirror = { tokens: ["iphone", "laptop", "legacy"], platforms: { iphone: "ios", laptop: "web" } };

  it("sends a dice push only to android and web tokens; untagged counts as iOS", async () => {
    const d = doc(dice());
    const dp = deps({
      pushTarget: vi.fn(async () => mirror),
      send: vi.fn(async () => ({
        failureCount: 1,
        responses: [{ success: false, error: { code: "messaging/registration-token-not-registered" } }],
      })),
    });
    expect(await deliverDispatch(d, dp)).toBe("sent");
    expect(dp.pushTarget).toHaveBeenCalledWith("u1");
    expect(dp.send).toHaveBeenCalledWith(expect.objectContaining({ tokens: ["laptop"] }));
    // A dice tap opens the dice table, the same route the service worker uses.
    expect(dp.send.mock.calls[0][0].webpush.fcmOptions.link).toBe("https://skatehubba.com/dice/g");
    // Dead-token pruning maps back to the filtered list, not the original one.
    expect(dp.prune).toHaveBeenCalledWith("u1", ["laptop"]);
  });

  it("drops a dice push with no eligible token without sending", async () => {
    const d = doc(dice({ data: { gameId: "g", type: "dice_challenge" } }));
    const dp = deps({ pushTarget: vi.fn(async () => ({ tokens: ["iphone"], platforms: { iphone: "ios" } })) });
    expect(await deliverDispatch(d, dp)).toBe("filtered");
    expect(dp.send).not.toHaveBeenCalled();
    expect(d.delete).toHaveBeenCalled();
  });

  it("leaves non-dice pushes alone, even to iOS tokens", async () => {
    const d = doc(good({ tokens: ["iphone"], data: { gameId: "g", type: "your_turn" } }));
    const dp = deps({ send: vi.fn(async () => ({ failureCount: 0, responses: [{ success: true }] })) });
    expect(await deliverDispatch(d, dp)).toBe("sent");
    expect(dp.pushTarget).not.toHaveBeenCalled();
    expect(dp.send).toHaveBeenCalledWith(expect.objectContaining({ tokens: ["iphone"] }));
  });

  it("keeps a dice push queued for retry when the platform lookup fails", async () => {
    const d = doc(dice());
    const dp = deps({ pushTarget: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect(await deliverDispatch(d, dp)).toBe("error");
    expect(dp.send).not.toHaveBeenCalled();
    expect(d.delete).not.toHaveBeenCalled();
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
    expect(s).toEqual({ scanned: 5, sent: 1, expired: 1, malformed: 1, filtered: 0, errors: 1, skippedFresh: 1 });
  });

  it("tallies dice pushes dropped by the platform check", async () => {
    const old = NOW - RETRY_MIN_AGE_MS - 1;
    const s = await drainQueue([doc(good({ createdAt: ts(old), data: { kind: "dice" } }), old)], deps());
    expect(s).toMatchObject({ scanned: 1, filtered: 1, sent: 0 });
  });
});

describe("dispatches without tokens (M1: courier looks them up)", () => {
  const tokenless = (over: Record<string, unknown> = {}) => {
    const { tokens: _omit, ...rest } = good(over);
    return rest;
  };

  it("resolves the recipient's tokens from pushTargets, de-duplicated and capped at 10", async () => {
    const many = Array.from({ length: 12 }, (_, i) => `m${i}`);
    const dp = deps({ pushTarget: vi.fn(async () => ({ tokens: ["m0", ...many, 7, ""] })) });
    const d = doc(tokenless());
    expect(await deliverDispatch(d, dp)).toBe("sent");
    expect(dp.pushTarget).toHaveBeenCalledWith("u1");
    expect(dp.send).toHaveBeenCalledWith(expect.objectContaining({ tokens: many.slice(0, 10) }));
    expect(d.delete).toHaveBeenCalled();
  });

  it("drops the doc unsent when the recipient has no devices", async () => {
    const dp = deps();
    const d = doc(tokenless());
    expect(await deliverDispatch(d, dp)).toBe("filtered");
    expect(dp.send).not.toHaveBeenCalled();
    expect(d.delete).toHaveBeenCalled();
  });

  it("applies the dice filter to resolved tokens with a single mirror read", async () => {
    const dp = deps({
      pushTarget: vi.fn(async () => ({ tokens: ["i", "w"], platforms: { i: "ios", w: "web" } })),
      send: vi.fn(async () => ({ failureCount: 0, responses: [{ success: true }] })),
    });
    const d = doc(tokenless({ data: { gameId: "g", type: "dice_your_turn", kind: "dice" } }));
    expect(await deliverDispatch(d, dp)).toBe("sent");
    expect(dp.pushTarget).toHaveBeenCalledTimes(1);
    expect(dp.send).toHaveBeenCalledWith(expect.objectContaining({ tokens: ["w"] }));
  });

  it("still sends a doc that names its own tokens, without reading the mirror (backward compatible)", async () => {
    const dp = deps();
    expect(await deliverDispatch(doc(good()), dp)).toBe("sent");
    expect(dp.pushTarget).not.toHaveBeenCalled();
    expect(dp.send).toHaveBeenCalledWith(expect.objectContaining({ tokens: ["a", "b"] }));
  });

  it("keeps a token-less doc queued for retry when the mirror lookup fails", async () => {
    const dp = deps({ pushTarget: vi.fn(async () => Promise.reject(new Error("unavailable"))) });
    const d = doc(tokenless());
    expect(await deliverDispatch(d, dp)).toBe("error");
    expect(d.delete).not.toHaveBeenCalled();
  });
});
