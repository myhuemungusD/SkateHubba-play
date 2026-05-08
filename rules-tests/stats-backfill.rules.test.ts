/**
 * Stats backfill — PR-A2 one-shot carve-out red team.
 *
 * The backfill carve-out (firestore.rules, plan §4.2) accepts a single
 * self-attested counter write per user when transitioning
 * `statsBackfilledAt` from null → request.time. Re-running the carve-out
 * after the field is set, or attempting to backfill a different user's
 * profile, MUST be rejected. Counters in the same write are accepted as
 * a documented limitation (audit S8 / TH12) — the Week 2 reconciliation
 * PR cross-checks them server-side.
 *
 * 6 scenarios per plan §6.2.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import type { RulesTestContext, RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { Timestamp, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const OWNER_UID = "owner-uid";
const OTHER_UID = "other-uid";

const getEnv: () => RulesTestEnvironment = setupRulesTestEnv("demo-skatehubba-rules-stats-backfill");

function asOwner(): RulesTestContext {
  return getEnv().authenticatedContext(OWNER_UID, { email_verified: true });
}

function ownerProfileRef(ctx: RulesTestContext) {
  return doc(ctx.firestore(), "users", OWNER_UID);
}

function otherProfileRef(ctx: RulesTestContext) {
  return doc(ctx.firestore(), "users", OTHER_UID);
}

/**
 * Seed a public profile doc. `statsBackfilledAt` defaults to null so
 * tests can opt out individually. Empty counter fields default to 0
 * to keep the rule's `statsCountersChanged` short-circuit predictable.
 */
async function seedProfile(uid: string, overrides: Record<string, unknown> = {}): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", uid), {
      uid,
      username: uid === OWNER_UID ? "alice" : "bob",
      stance: "Regular",
      gamesWon: 0,
      gamesLost: 0,
      gamesForfeited: 0,
      tricksLanded: 0,
      currentWinStreak: 0,
      longestWinStreak: 0,
      cleanJudgments: 0,
      xp: 0,
      level: 1,
      statsBackfilledAt: null,
      ...overrides,
    });
  });
}

describe("users/{uid} — backfill carve-out (PR-A2)", () => {
  it("(1) ALLOW: first backfill (statsBackfilledAt: null → request.time)", async () => {
    await seedProfile(OWNER_UID);
    // Self-attested counters land in the same write — the carve-out
    // intentionally bypasses the linked-game proof for backfill writes.
    await assertSucceeds(
      updateDoc(ownerProfileRef(asOwner()), {
        gamesWon: 12,
        gamesLost: 8,
        gamesForfeited: 1,
        tricksLanded: 47,
        currentWinStreak: 3,
        longestWinStreak: 5,
        statsBackfilledAt: serverTimestamp(),
      }),
    );
  });

  it("(2) DENY: second backfill attempt (statsBackfilledAt already set)", async () => {
    await seedProfile(OWNER_UID, { statsBackfilledAt: Timestamp.now() });
    await assertFails(
      updateDoc(ownerProfileRef(asOwner()), {
        gamesWon: 99,
        statsBackfilledAt: serverTimestamp(),
      }),
    );
  });

  it("(3) DENY: backfill with negative counters", async () => {
    // The carve-out enforces a non-negative floor on every counter
    // field — see firestore.rules. Self-attested values >= 0 pass
    // (audit accepts the trade-off, TH12); anything below zero is
    // unambiguous garbage and would corrupt every downstream consumer.
    await seedProfile(OWNER_UID);
    await assertFails(
      updateDoc(ownerProfileRef(asOwner()), {
        gamesWon: -1,
        statsBackfilledAt: serverTimestamp(),
      }),
    );
  });

  it("(4) DENY: backfill on someone else's profile", async () => {
    await seedProfile(OTHER_UID);
    await assertFails(
      updateDoc(otherProfileRef(asOwner()), {
        gamesWon: 5,
        statsBackfilledAt: serverTimestamp(),
      }),
    );
  });

  it("(5) ALLOW: backfill with gamesWon > 1000 (Sentry-flagged at service)", async () => {
    // Audit S8: the rule does NOT block large counter values during
    // backfill — flagging them is the service layer's job. The cap on
    // counter values is enforced by the reconciliation PR, not by
    // Firestore rules.
    await seedProfile(OWNER_UID);
    await assertSucceeds(
      updateDoc(ownerProfileRef(asOwner()), {
        gamesWon: 1500,
        statsBackfilledAt: serverTimestamp(),
      }),
    );
  });

  it("(6) DENY: backfill that doesn't set statsBackfilledAt to request.time", async () => {
    await seedProfile(OWNER_UID);
    // Writing a literal Timestamp from the client (instead of
    // serverTimestamp() sentinel) breaks the request.time equality.
    await assertFails(
      updateDoc(ownerProfileRef(asOwner()), {
        gamesWon: 5,
        statsBackfilledAt: Timestamp.fromMillis(Date.now() - 60_000),
      }),
    );
  });
});
