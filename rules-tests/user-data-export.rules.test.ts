/**
 * "Download my data" runs these exact queries (src/services/userDataQueries.ts)
 * as the signed-in owner. Rules are not filters: if a query can't prove every
 * doc it might return is readable, Firestore refuses the whole query and the
 * export comes back missing that section. This suite pins that each export
 * query is allowed for the owner, returns the owner's docs, and is refused
 * for someone else where the data is private.
 *
 * (The emulator doesn't enforce composite indexes, so the "no orderBy" half
 * of the fix is pinned in src/services/__tests__/userData.test.ts instead.)
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDocs, limit, query, setDoc, where, type Firestore } from "firebase/firestore";
import { authedContext, setupRulesTestEnv } from "./_fixtures";
import { exportCollectionQueries, type ExportQueryName } from "../src/services/userDataQueries";

const OWNER = "export-owner";
const OTHER = "export-other";

/** One owned doc per export surface, plus decoys that must not come back. */
const SEED: Array<[string, Record<string, unknown>]> = [
  ["games/g-p1", { player1Uid: OWNER, player2Uid: OTHER }],
  ["games/g-p2", { player1Uid: OTHER, player2Uid: OWNER }],
  ["games/g-judge", { player1Uid: OTHER, player2Uid: "export-third", judgeId: OWNER }],
  ["clips/c1", { playerUid: OWNER, moderationStatus: "pending" }],
  ["clipVotes/v1", { uid: OWNER, clipId: "c-elsewhere" }],
  ["spots/s-live", { createdBy: OWNER, isActive: true }],
  ["spots/s-removed", { createdBy: OWNER, isActive: false }],
  ["notifications/n1", { recipientUid: OWNER }],
  ["nudges/nu-sent", { senderUid: OWNER, recipientUid: OTHER }],
  ["nudges/nu-got", { senderUid: OTHER, recipientUid: OWNER }],
  [`users/${OWNER}/blocked_users/${OTHER}`, { blockedUid: OTHER }],
  ["reports/r1", { reporterUid: OWNER }],
  ["moderationStatements/m1", { subjectUid: OWNER }],
  ["appeals/a1", { appellantUid: OWNER }],
];

const EXPECTED: Record<ExportQueryName, string[]> = {
  gamesAsPlayer1: ["g-p1"],
  gamesAsPlayer2: ["g-p2"],
  gamesAsJudge: ["g-judge"],
  clips: ["c1"],
  clipVotes: ["v1"],
  spots: ["s-live"],
  notifications: ["n1"],
  nudgesSent: ["nu-sent"],
  nudgesReceived: ["nu-got"],
  blockedUsers: [OTHER],
  reports: ["r1"],
  moderationStatements: ["m1"],
  appeals: ["a1"],
};

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-user-data-export", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (const [path, data] of SEED) await setDoc(doc(db, path), data);
  });
});

function ownerDb(): Firestore {
  return authedContext(getEnv(), OWNER).firestore() as unknown as Firestore;
}

describe("user data export queries", () => {
  it.each(Object.keys(EXPECTED) as ExportQueryName[])("the owner can run the %s query", async (name) => {
    const snap = await assertSucceeds(getDocs(exportCollectionQueries(ownerDb(), OWNER)[name]));
    expect(snap.docs.map((d) => d.id).sort()).toEqual(EXPECTED[name]);
  });

  it("needs the isActive filter on spots: without it the whole query is refused", async () => {
    const db = ownerDb();
    await assertFails(getDocs(query(collection(db, "spots"), where("createdBy", "==", OWNER), limit(500))));
  });

  it.each(["notifications", "nudgesReceived", "blockedUsers", "reports", "moderationStatements", "appeals"] as const)(
    "someone else can't run the owner's %s query",
    async (name) => {
      const otherDb = authedContext(getEnv(), OTHER).firestore() as unknown as Firestore;
      await assertFails(getDocs(exportCollectionQueries(otherDb, OWNER)[name]));
    },
  );
});
