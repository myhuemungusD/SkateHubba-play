/**
 * DSA notice-and-action rules: illegal-content reports, statements of
 * reasons, and appeals. The reported user can read a statement and file
 * an appeal; they still cannot read the report itself.
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  setLogLevel,
} from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-dsa";
const REPORTER = "reporter-alice";
const SUBJECT = "subject-bob";
const ADMIN = "admin-casey";
const STRANGER = "stranger-drew";
const REPORT_ID = "report-1";

let testEnv: RulesTestEnvironment;

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

function reportBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reporterUid: REPORTER,
    reportedUid: SUBJECT,
    reportedUsername: "bob",
    gameId: "game-1",
    reason: "illegal_content",
    description: "This clip shows illegal content in detail.",
    status: "pending",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function statementBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    subjectUid: SUBJECT,
    reportId: REPORT_ID,
    action: "content_restricted",
    reason: "illegal_content",
    explanation: "The clip was removed because it contains illegal content.",
    contentRef: "game-1",
    createdBy: ADMIN,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

async function fileReport(overrides: Record<string, unknown> = {}): Promise<void> {
  const db = testEnv.authenticatedContext(REPORTER, { email_verified: true }).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, "reports", REPORT_ID), reportBody(overrides));
  batch.set(doc(db, "reports_limits", `${REPORTER}_${SUBJECT}`), {
    reporterUid: REPORTER,
    reportedUid: SUBJECT,
    lastSentAt: serverTimestamp(),
  });
  await batch.commit();
}

async function resolveReport(): Promise<void> {
  const db = testEnv.authenticatedContext(ADMIN, { admin: true, email_verified: true }).firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, "reports", REPORT_ID), {
    status: "resolved",
    resolvedBy: ADMIN,
    resolvedAt: serverTimestamp(),
  });
  batch.set(doc(db, "moderationStatements", REPORT_ID), statementBody());
  await batch.commit();
}

function banAppeal(explanation: string): Record<string, unknown> {
  return {
    appellantUid: SUBJECT,
    targetKind: "ban",
    targetId: SUBJECT,
    explanation,
    status: "pending",
    createdAt: serverTimestamp(),
  };
}

async function seedBan(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "bans", SUBJECT), {
      bannedBy: ADMIN,
      bannedAt: new Date(),
      reason: "Repeated spam",
    });
  });
}

describe("reports — illegal content", () => {
  it("accepts an illegal-content report that explains what is illegal", async () => {
    await assertSucceeds(fileReport());
  });

  it("rejects an illegal-content report with a short explanation", async () => {
    await assertFails(fileReport({ description: "too short" }));
  });

  it("still accepts a blank explanation for other reasons", async () => {
    await assertSucceeds(fileReport({ reason: "spam", description: "" }));
  });

  it("lets the reporter list their own reports", async () => {
    await fileReport({ reason: "spam", description: "" });
    const db = testEnv.authenticatedContext(REPORTER, { email_verified: true }).firestore();
    const snap = await assertSucceeds(getDocs(query(collection(db, "reports"), where("reporterUid", "==", REPORTER))));
    expect(snap.docs.map((d: { id: string }) => d.id)).toEqual([REPORT_ID]);
  });

  it("still hides the report from the person it is about", async () => {
    await fileReport({ reason: "spam", description: "" });
    const db = testEnv.authenticatedContext(SUBJECT, { email_verified: true }).firestore();
    await assertFails(getDoc(doc(db, "reports", REPORT_ID)));
  });
});

describe("moderationStatements and appeals", () => {
  it("rejects a resolve that does not write a statement", async () => {
    await fileReport({ reason: "spam", description: "" });
    const db = testEnv.authenticatedContext(ADMIN, { admin: true }).firestore();
    await assertFails(
      updateDoc(doc(db, "reports", REPORT_ID), {
        status: "resolved",
        resolvedBy: ADMIN,
        resolvedAt: serverTimestamp(),
      }),
    );
  });

  it("lets an admin dismiss without a statement", async () => {
    await fileReport({ reason: "spam", description: "" });
    const db = testEnv.authenticatedContext(ADMIN, { admin: true }).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "reports", REPORT_ID), {
        status: "dismissed",
        resolvedBy: ADMIN,
        resolvedAt: serverTimestamp(),
      }),
    );
  });

  it("writes the statement in the same batch and lets the subject read it", async () => {
    await fileReport({ reason: "spam", description: "" });
    await assertSucceeds(resolveReport());
    const db = testEnv.authenticatedContext(SUBJECT, { email_verified: true }).firestore();
    const snap = await assertSucceeds(getDoc(doc(db, "moderationStatements", REPORT_ID)));
    expect(snap.data()?.explanation).toBe("The clip was removed because it contains illegal content.");
  });

  it("hides the statement from a stranger", async () => {
    await fileReport({ reason: "spam", description: "" });
    await resolveReport();
    const db = testEnv.authenticatedContext(STRANGER, { email_verified: true }).firestore();
    await assertFails(getDoc(doc(db, "moderationStatements", REPORT_ID)));
  });

  it("rejects a statement written by someone who is not an admin", async () => {
    await fileReport({ reason: "spam", description: "" });
    const db = testEnv.authenticatedContext(SUBJECT, { email_verified: true }).firestore();
    await assertFails(setDoc(doc(db, "moderationStatements", REPORT_ID), statementBody({ createdBy: SUBJECT })));
  });

  it("lets the subject appeal the statement once", async () => {
    await fileReport({ reason: "spam", description: "" });
    await resolveReport();
    const db = testEnv.authenticatedContext(SUBJECT, {}).firestore();
    await assertSucceeds(
      setDoc(doc(db, "appeals", `statement_${REPORT_ID}`), {
        appellantUid: SUBJECT,
        targetKind: "statement",
        targetId: REPORT_ID,
        explanation: "The clip was mine and it is not illegal.",
        status: "pending",
        createdAt: serverTimestamp(),
      }),
    );
    await assertFails(
      setDoc(doc(db, "appeals", `statement_${REPORT_ID}`), {
        appellantUid: SUBJECT,
        targetKind: "statement",
        targetId: REPORT_ID,
        explanation: "A second try at the same appeal.",
        status: "pending",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("rejects an appeal of someone else's statement", async () => {
    await fileReport({ reason: "spam", description: "" });
    await resolveReport();
    const db = testEnv.authenticatedContext(STRANGER, {}).firestore();
    await assertFails(
      setDoc(doc(db, "appeals", `statement_${REPORT_ID}`), {
        appellantUid: STRANGER,
        targetKind: "statement",
        targetId: REPORT_ID,
        explanation: "I am not the subject of this statement.",
        status: "pending",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("lets a banned user appeal the ban without a verified email", async () => {
    await seedBan();
    const db = testEnv.authenticatedContext(SUBJECT, {}).firestore();
    await assertSucceeds(
      setDoc(doc(db, "appeals", `ban_${SUBJECT}`), banAppeal("Please review the restriction on my account.")),
    );
  });

  it("rejects a ban appeal when the caller is not banned", async () => {
    const db = testEnv.authenticatedContext(SUBJECT, {}).firestore();
    await assertFails(
      setDoc(doc(db, "appeals", `ban_${SUBJECT}`), {
        appellantUid: SUBJECT,
        targetKind: "ban",
        targetId: SUBJECT,
        explanation: "There is no ban on this account.",
        status: "pending",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("lets an admin close an appeal and stops the appellant editing it", async () => {
    await seedBan();
    const subjectDb = testEnv.authenticatedContext(SUBJECT, {}).firestore();
    await setDoc(
      doc(subjectDb, "appeals", `ban_${SUBJECT}`),
      banAppeal("Please review the restriction on my account."),
    );

    await assertFails(
      updateDoc(doc(subjectDb, "appeals", `ban_${SUBJECT}`), {
        status: "upheld",
        reviewedBy: SUBJECT,
        reviewedAt: serverTimestamp(),
      }),
    );

    const adminDb = testEnv.authenticatedContext(ADMIN, { admin: true }).firestore();
    await assertSucceeds(
      updateDoc(doc(adminDb, "appeals", `ban_${SUBJECT}`), {
        status: "upheld",
        reviewedBy: ADMIN,
        reviewedAt: serverTimestamp(),
      }),
    );
  });
});
