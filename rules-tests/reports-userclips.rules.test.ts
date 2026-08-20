/**
 * /reports — user-clip reporting surface.
 *
 * Two deltas land with the user-clip feed:
 *   1. `non_skate_content` joins the reason allowlist (the moderation
 *      category the feed actually needs — off-topic uploads).
 *   2. `gameId` may be null, but ONLY when the report identifies the clip
 *      it targets. A null gameId with no clipId would be an unattributable
 *      report — a pure moderator-queue DoS.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const REPORTER = "reporter-alice";
const REPORTED = "reported-bob";
const LIMIT_ID = `${REPORTER}_${REPORTED}`;

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-reports-userclips");

function reporterCtx(): RulesTestContext {
  return getEnv().authenticatedContext(REPORTER, { email_verified: true });
}

/** Report + mandatory companion limit doc, the production batch shape. */
function submitReport(overrides: Record<string, unknown> = {}, omitClipId = false): Promise<void> {
  const ctx = reporterCtx();
  const batch = writeBatch(ctx.firestore());
  const report: Record<string, unknown> = {
    reporterUid: REPORTER,
    reportedUid: REPORTED,
    reportedUsername: "bob",
    gameId: null,
    clipId: "some-user-clip-id",
    reason: "non_skate_content",
    description: "not skateboarding",
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
  if (omitClipId) delete report.clipId;
  batch.set(doc(ctx.firestore(), "reports", "r1"), report);
  batch.set(doc(ctx.firestore(), "reports_limits", LIMIT_ID), {
    reporterUid: REPORTER,
    reportedUid: REPORTED,
    lastSentAt: serverTimestamp(),
  });
  return batch.commit();
}

describe("reports — user-clip reason + nullable gameId", () => {
  it("accepts non_skate_content against a user clip with gameId: null", async () => {
    await assertSucceeds(submitReport());
  });

  it("accepts non_skate_content on a game-sourced report too", async () => {
    await assertSucceeds(submitReport({ gameId: "g-1", clipId: "g-1_2_set" }));
  });

  it("still accepts the pre-existing reasons (no regression)", async () => {
    await assertSucceeds(submitReport({ reason: "inappropriate_video" }));
  });

  it("attack: a made-up reason is still rejected", async () => {
    await assertFails(submitReport({ reason: "i_dont_like_them" }));
  });

  it("attack: gameId: null with NO clipId is rejected (unattributable report)", async () => {
    await assertFails(submitReport({}, true));
  });

  it("attack: gameId: null with an EMPTY clipId is rejected", async () => {
    await assertFails(submitReport({ clipId: "" }));
  });

  it("attack: a non-string, non-null gameId is rejected", async () => {
    await assertFails(submitReport({ gameId: 42 }));
  });
});
