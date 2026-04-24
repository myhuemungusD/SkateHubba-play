/**
 * Reports rate-limit red-team — proves the H-R2 April 2026 hardening that
 * gates `/reports` creation on a companion `/reports_limits/{reporter_
 * reported}` write with a 1-hour cooldown.
 *
 * Before the fix, the rule comment claimed uniqueness was enforced by a
 * "client query + check" — i.e. not enforced at all in Firestore rules.
 * That's a harassment vector (spam-reports against a single target) and a
 * moderator-queue DoS. The hardened rule:
 *
 *   1. Rejects a report unless the batch also writes
 *      reports_limits/{reporter_reported} with lastSentAt == request.time.
 *   2. Rejects the report if the prior limit doc exists AND the stored
 *      lastSentAt is within the last hour.
 *   3. Pins lastSentAt on the limit doc to request.time on both create and
 *      update, closing the back-date bypass (epoch 0 → permanently satisfy
 *      the cooldown).
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deleteDoc, doc, serverTimestamp, setDoc, setLogLevel, updateDoc, writeBatch } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-reports-redteam";

const REPORTER_UID = "reporter-alice";
const REPORTED_UID = "reported-bob";
const GAME_ID = "g-report";
const LIMIT_ID = `${REPORTER_UID}_${REPORTED_UID}`;

let testEnv: RulesTestEnvironment;

function asReporter(): RulesTestContext {
  return testEnv.authenticatedContext(REPORTER_UID, { email_verified: true });
}

function makeValidReport(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reporterUid: REPORTER_UID,
    reportedUid: REPORTED_UID,
    reportedUsername: "bob",
    gameId: GAME_ID,
    reason: "abusive_behavior",
    description: "test report",
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function seedLimit(lastSentAt: Date): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "reports_limits", LIMIT_ID), {
      reporterUid: REPORTER_UID,
      reportedUid: REPORTED_UID,
      lastSentAt,
    });
  });
}

/** Batch-write a report AND its companion limit doc — the prod shape. */
async function submitReportBatch(
  reportOverrides: Record<string, unknown> = {},
  limitOverrides: Record<string, unknown> = {},
): Promise<void> {
  const ctx = asReporter();
  const reportRef = doc(ctx.firestore(), "reports", "r1");
  const limitRef = doc(ctx.firestore(), "reports_limits", LIMIT_ID);
  const batch = writeBatch(ctx.firestore());
  batch.set(reportRef, makeValidReport(reportOverrides));
  batch.set(limitRef, {
    reporterUid: REPORTER_UID,
    reportedUid: REPORTED_UID,
    lastSentAt: serverTimestamp(),
    ...limitOverrides,
  });
  await batch.commit();
}

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("reports — companion write + 1h cooldown", () => {
  it("legitimate: first-ever report writes both the report and the limit doc", async () => {
    await assertSucceeds(submitReportBatch());
  });

  it("attack: CANNOT submit a report without the companion reports_limits write", async () => {
    // The client-only report write fails the getAfter() check — the limit
    // doc doesn't exist after the commit because the client didn't include
    // it in the batch.
    const ctx = asReporter();
    await assertFails(setDoc(doc(ctx.firestore(), "reports", "r1"), makeValidReport()));
  });

  it("attack: CANNOT submit a second report 59 minutes after the first", async () => {
    // Seed a limit doc with lastSentAt 59 min ago — just inside the 1h
    // cooldown. The create rule's get() branch should reject.
    await seedLimit(new Date(Date.now() - 59 * 60 * 1000));
    await assertFails(submitReportBatch());
  });

  it("legitimate: CAN submit a second report 61 minutes after the first", async () => {
    await seedLimit(new Date(Date.now() - 61 * 60 * 1000));
    await assertSucceeds(submitReportBatch());
  });

  it("attack: CANNOT spoof the limit doc with a stale lastSentAt on create", async () => {
    // The companion write tries to pin lastSentAt to epoch 0 so the
    // cooldown is instantly satisfied on every future report. The limit
    // doc's own create rule (lastSentAt == request.time) rejects this —
    // which cascades to fail the report batch as a whole.
    await assertFails(submitReportBatch({}, { lastSentAt: new Date(0) }));
  });

  it("attack: CANNOT spoof the limit doc with a client-wall-clock lastSentAt", async () => {
    // Even a "now-ish" client timestamp is rejected — only request.time
    // (serverTimestamp) is trusted. Matches the notification_limits and
    // nudge_limits pattern.
    await assertFails(submitReportBatch({}, { lastSentAt: new Date() }));
  });

  it("attack: CANNOT update an existing limit doc with a stale lastSentAt", async () => {
    // Seed a cooldown that's already expired. Attacker tries to update
    // lastSentAt to a stale value so the cooldown stays "expired" forever.
    await seedLimit(new Date(Date.now() - 2 * 60 * 60 * 1000));
    await assertFails(
      updateDoc(doc(asReporter().firestore(), "reports_limits", LIMIT_ID), {
        lastSentAt: new Date(0),
      }),
    );
  });

  it("attack: CANNOT update the limit doc before the 1h cooldown expires", async () => {
    await seedLimit(new Date(Date.now() - 30 * 60 * 1000));
    await assertFails(
      updateDoc(doc(asReporter().firestore(), "reports_limits", LIMIT_ID), {
        lastSentAt: serverTimestamp(),
      }),
    );
  });

  it("attack: CANNOT delete the limit doc to reset the cooldown", async () => {
    await seedLimit(new Date(Date.now() - 30 * 60 * 1000));
    await assertFails(deleteDoc(doc(asReporter().firestore(), "reports_limits", LIMIT_ID)));
  });

  it("attack: CANNOT mutate reporterUid on the limit doc (cross-pollute)", async () => {
    await seedLimit(new Date(Date.now() - 2 * 60 * 60 * 1000));
    await assertFails(
      updateDoc(doc(asReporter().firestore(), "reports_limits", LIMIT_ID), {
        reporterUid: "someone-else",
        lastSentAt: serverTimestamp(),
      }),
    );
  });

  it("attack: CANNOT mutate reportedUid on the limit doc", async () => {
    await seedLimit(new Date(Date.now() - 2 * 60 * 60 * 1000));
    await assertFails(
      updateDoc(doc(asReporter().firestore(), "reports_limits", LIMIT_ID), {
        reportedUid: "different-victim",
        lastSentAt: serverTimestamp(),
      }),
    );
  });

  it("attack: CANNOT create a limit doc whose id doesn't match reporter_reported", async () => {
    const ctx = asReporter();
    await assertFails(
      setDoc(doc(ctx.firestore(), "reports_limits", "wrong_id"), {
        reporterUid: REPORTER_UID,
        reportedUid: REPORTED_UID,
        lastSentAt: serverTimestamp(),
      }),
    );
  });
});
