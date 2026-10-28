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
 * Long lists are read a page at a time with startAfter; the paging test
 * pins that a later page is allowed too (same constraints, same rule).
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  query,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { authedContext, setupRulesTestEnv } from "./_fixtures";
import { exportCollectionQueries, exportNextPage, type ExportQueryName } from "../src/services/userDataQueries";

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
  ["spots/s-live2", { createdBy: OWNER, isActive: true }],
  ["spots/s-removed", { createdBy: OWNER, isActive: false }],
  ["spots/s-other-live", { createdBy: OTHER, isActive: true }],
  ["spots/s-other-removed", { createdBy: OTHER, isActive: false }],
  ["notifications/n1", { recipientUid: OWNER }],
  ["notifications/n2", { recipientUid: OWNER }],
  ["notifications/n-other", { recipientUid: OTHER }],
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
  spots: ["s-live", "s-live2"],
  spotsInactive: ["s-removed"],
  notifications: ["n1", "n2"],
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
    const snap = await assertSucceeds(getDocsFromServer(exportCollectionQueries(ownerDb(), OWNER)[name]));
    expect(snap.docs.map((d) => d.id).sort()).toEqual(EXPECTED[name]);
  });

  it.each(["spots", "spotsInactive", "notifications", "gamesAsPlayer1"] as const)(
    "the owner can page through the %s query with startAfter",
    async (name) => {
      // limit(1) overrides the export page size so a few seeded docs span pages.
      const first = query(exportCollectionQueries(ownerDb(), OWNER)[name], limit(1));
      const seen: string[] = [];
      let snap = await assertSucceeds(getDocsFromServer(first));
      while (snap.docs.length > 0) {
        seen.push(...snap.docs.map((d) => d.id));
        snap = await assertSucceeds(getDocsFromServer(exportNextPage(first, snap.docs[snap.docs.length - 1])));
      }
      expect(seen.sort()).toEqual(EXPECTED[name]);
    },
  );

  describe("spots the owner created (1.2.1 creator rule)", () => {
    function otherDb(): Firestore {
      return authedContext(getEnv(), OTHER).firestore() as unknown as Firestore;
    }

    it("the creator can read their own inactive spot by id", async () => {
      const snap = await assertSucceeds(getDocFromServer(doc(ownerDb(), "spots/s-removed")));
      expect(snap.data()).toMatchObject({ createdBy: OWNER, isActive: false });
    });

    it("someone else can't read the owner's inactive spot, by id or by query", async () => {
      await assertFails(getDocFromServer(doc(otherDb(), "spots/s-removed")));
      await assertFails(getDocsFromServer(exportCollectionQueries(otherDb(), OWNER).spotsInactive));
      await assertFails(
        getDocsFromServer(query(collection(otherDb(), "spots"), where("createdBy", "==", OWNER), limit(500))),
      );
    });

    it("the owner can't read someone else's inactive spot", async () => {
      await assertFails(getDocFromServer(doc(ownerDb(), "spots/s-other-removed")));
      await assertFails(
        getDocsFromServer(query(collection(ownerDb(), "spots"), where("isActive", "==", false), limit(500))),
      );
    });

    it("the original active-spots query still works, for the owner and for anyone signed in", async () => {
      const own = await assertSucceeds(getDocsFromServer(exportCollectionQueries(ownerDb(), OWNER).spots));
      expect(own.docs.map((d) => d.id).sort()).toEqual(["s-live", "s-live2"]);
      const theirs = await assertSucceeds(getDocsFromServer(exportCollectionQueries(otherDb(), OWNER).spots));
      expect(theirs.docs.map((d) => d.id).sort()).toEqual(["s-live", "s-live2"]);
    });

    it("the creator's own createdBy query no longer needs the isActive filter", async () => {
      const snap = await assertSucceeds(
        getDocsFromServer(query(collection(ownerDb(), "spots"), where("createdBy", "==", OWNER), limit(500))),
      );
      expect(snap.docs.map((d) => d.id).sort()).toEqual(["s-live", "s-live2", "s-removed"]);
    });
  });

  it.each(["notifications", "nudgesReceived", "blockedUsers", "reports", "moderationStatements", "appeals"] as const)(
    "someone else can't run the owner's %s query",
    async (name) => {
      const otherDb = authedContext(getEnv(), OTHER).firestore() as unknown as Firestore;
      await assertFails(getDocsFromServer(exportCollectionQueries(otherDb, OWNER)[name]));
    },
  );
});
