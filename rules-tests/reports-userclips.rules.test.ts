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
import { beforeEach, describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
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

  it("accepts not_skating", async () => {
    await assertSucceeds(submitReport({ reason: "not_skating" }));
  });

  it("accepts inappropriate", async () => {
    await assertSucceeds(submitReport({ reason: "inappropriate" }));
  });

  it("attack: a made-up reason is still rejected", async () => {
    await assertFails(submitReport({ reason: "i_dont_like_them" }));
  });

  it("accepts a dispute id on a game report", async () => {
    await assertSucceeds(submitReport({ gameId: "g-1", disputeId: "g-1_3" }, true));
  });

  it("attack: an oversized dispute id is rejected", async () => {
    await assertFails(submitReport({ gameId: "g-1", disputeId: "d".repeat(129) }));
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

describe("reports — single comments and spot targets", () => {
  const CLIP = "some-user-clip-id";
  const SPOT = "spot-1";

  beforeEach(async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "clips", CLIP, "comments", "cm1"), { userId: REPORTED, username: "bob", text: "rude" });
      await setDoc(doc(db, "spots", SPOT, "comments", "cm1"), { userId: REPORTED, content: "rude" });
      await setDoc(doc(db, "clips", CLIP, "comments", "mine"), { userId: "someone-else", text: "rude" });
    });
  });

  it("accepts a clip comment report whose quote matches the real comment", async () => {
    await assertSucceeds(submitReport({ commentId: "cm1", commentText: "rude" }));
  });

  it("accepts a spot comment report with no game and no clip", async () => {
    await assertSucceeds(submitReport({ spotId: SPOT, commentId: "cm1", commentText: "rude" }, true));
  });

  it("rejects a made-up quote on a real comment", async () => {
    await assertFails(submitReport({ commentId: "cm1", commentText: "something bob never said" }));
    await assertFails(submitReport({ spotId: SPOT, commentId: "cm1", commentText: "fake" }, true));
  });

  it("rejects a comment report naming someone other than the comment's author", async () => {
    await assertFails(submitReport({ commentId: "mine", commentText: "rude" }));
  });

  it("rejects a report on a comment that doesn't exist", async () => {
    await assertFails(submitReport({ commentId: "ghost", commentText: "rude" }));
  });

  it("rejects a comment report with both a clip and a spot, or neither", async () => {
    await assertFails(submitReport({ spotId: SPOT, commentId: "cm1", commentText: "rude" }));
    await assertFails(submitReport({ gameId: "g-1", commentId: "cm1", commentText: "rude" }, true));
  });

  it("rejects a comment id without its quote", async () => {
    await assertFails(submitReport({ commentId: "cm1" }));
  });

  it("rejects a null-game report with an empty spot id and no clip", async () => {
    await assertFails(submitReport({ spotId: "" }, true));
  });

  it("rejects comment text without a comment id, or longer than a comment", async () => {
    await assertFails(submitReport({ commentText: "rude" }));
    await assertFails(submitReport({ commentId: "cm1", commentText: "x".repeat(301) }));
  });

  it("rejects an over-long spot id or comment id", async () => {
    await assertFails(submitReport({ spotId: "s".repeat(129) }, true));
    await assertFails(submitReport({ commentId: "c".repeat(129), commentText: "rude" }));
  });
});
