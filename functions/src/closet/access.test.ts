import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import {
  assertAccount,
  assertTradeSecurity,
  closetAllowed,
  CLOSET_FLAGS_OFF,
  DROP_RULE,
  TRADE_RULE,
  type ClosetFeature,
} from "./access.js";
import { DAY_MS } from "./model.js";
import { actor, errorCode, MemDb, NOW, seedUser } from "./testkit.js";

describe("closetAllowed", () => {
  it("is off for everyone but testers by default", () => {
    expect(closetAllowed("u", CLOSET_FLAGS_OFF, "closet")).toBe(false);
    expect(closetAllowed("u", { ...CLOSET_FLAGS_OFF, testers: " x , u " }, "trading")).toBe(true);
  });

  it("needs the master switch plus the feature flag", () => {
    const on = { ...CLOSET_FLAGS_OFF, enabled: true };
    expect(closetAllowed("u", on, "closet")).toBe(true);
    expect(closetAllowed("u", on, "drops")).toBe(false);
    expect(closetAllowed("u", { ...on, drops: true }, "drops")).toBe(true);
    expect(closetAllowed("u", { ...on, trading: true }, "trading")).toBe(true);
    expect(closetAllowed("u", { ...on, bucksPurchase: true }, "bucksPurchase")).toBe(true);
    expect(closetAllowed("u", { ...CLOSET_FLAGS_OFF, drops: true }, "drops")).toBe(false);
    expect(() => closetAllowed("u", on, "nope" as ClosetFeature)).toThrow("unknown closet feature");
  });
});

describe("assertAccount", () => {
  const check = (db: MemDb, rule = DROP_RULE) => db.runTransaction((tx) => assertAccount(tx, "u", NOW, rule));

  it("returns the profile for an eligible account", async () => {
    const db = seedUser(new MemDb(), "u");
    expect(await check(db)).toMatchObject({ username: "u" });
  });

  it("rejects missing, banned, new and inexperienced accounts", async () => {
    expect(await errorCode(() => check(new MemDb()))).toBe("not_found");
    expect(await errorCode(() => check(seedUser(new MemDb(), "u").seed("bans/u", { reason: "x" })))).toBe("banned");
    const fresh = seedUser(new MemDb(), "u", { createdAt: Timestamp.fromMillis(NOW - 6 * DAY_MS) });
    expect(await errorCode(() => check(fresh))).toBe("account_too_new");
    expect(await errorCode(() => check(seedUser(new MemDb(), "u", { createdAt: null })))).toBe("account_too_new");
    expect(await errorCode(() => check(seedUser(new MemDb(), "u", { gamesPlayed: 2 })))).toBe("not_enough_games");
    const tenDays = seedUser(new MemDb(), "u", { createdAt: Timestamp.fromMillis(NOW - 10 * DAY_MS) });
    expect(await errorCode(() => check(tenDays, TRADE_RULE))).toBe("account_too_new");
  });
});

describe("assertTradeSecurity", () => {
  it("needs a verified email and 2-step or a Google/Apple sign-in", () => {
    expect(() => assertTradeSecurity(actor("u", { emailVerified: false }))).toThrow("email_unverified");
    expect(() => assertTradeSecurity(actor("u", { secondFactor: false }))).toThrow("two_step_required");
    expect(() => assertTradeSecurity(actor("u", { secondFactor: false, provider: "google.com" }))).not.toThrow();
    expect(() => assertTradeSecurity(actor("u", { secondFactor: false, provider: "apple.com" }))).not.toThrow();
    expect(() => assertTradeSecurity(actor("u"))).not.toThrow();
  });
});
