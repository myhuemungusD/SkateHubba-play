/**
 * "Download my data" runs the reads in exportReadPlan
 * (src/services/userDataQueries.ts), built from FIRESTORE_EXPORT in
 * api/account/_userDataRegistry.ts, as the signed-in owner. Rules are not
 * filters: if a query can't prove every doc it might return is readable,
 * Firestore refuses the whole query and the export comes back missing that
 * section. This suite runs EVERY planned read as the owner against the
 * emulator, so a registry entry whose read the rules refuse fails here, and
 * checks it returns the owner's doc and not someone else's.
 *
 * The seed is generated from the registry itself (one doc per read for the
 * owner, one decoy for OTHER), with fixed extra fields where a read rule
 * checks more than the owner field. Fake uids only.
 *
 * (The emulator doesn't enforce composite indexes, so the "equality filters
 * only" half is pinned in src/services/__tests__/userData.test.ts.)
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collectionGroup,
  doc,
  getDocFromServer,
  getDocsFromServer,
  limit,
  query,
  setDoc,
  where,
  type Firestore,
} from "firebase/firestore";
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { authedContext, setupRulesTestEnv } from "./_fixtures";
import { FIRESTORE_EXPORT, type ExportIncluded, type ExportRead } from "../api/account/_userDataRegistry";
import { exportNextPage, exportReadPlan, type ExportStep } from "../src/services/userDataQueries";

const OWNER = "export-owner";
const OTHER = "export-other";
const NAME = "export-owner-name";

/** Extra fields a read rule checks on the doc itself (gets, not queries). */
const EXTRA: Record<string, Record<string, unknown>> = {};

const INCLUDED = Object.entries(FIRESTORE_EXPORT).filter((e): e is [string, ExportIncluded] => "section" in e[1]);

/** [path, data, ownedByOwner] seeds for one read of one registry key. */
function seedsFor(key: string, read: ExportRead): Array<[string, Record<string, unknown>, boolean]> {
  const extra = EXTRA[key] ?? {};
  const [top, , sub] = key.split("/");
  switch (read.kind) {
    case "uidDoc":
      return [
        [`${key}/${OWNER}`, { ...extra, uid: OWNER }, true],
        [`${key}/${OTHER}`, { ...extra, uid: OTHER }, false],
      ];
    case "ownDoc":
      return [[`users/${OWNER}/${sub}/${read.id}`, { ...extra }, true]];
    case "ownList":
      return [
        [`users/${OWNER}/${sub}/own-1`, { ...extra }, true],
        [`users/${OTHER}/${sub}/decoy-1`, { ...extra }, false],
      ];
    case "usernameDoc":
      return [[`${key}/${NAME}`, { ...extra, uid: OWNER }, true]];
    case "where":
      return [
        [`${key}/own-${read.field}`, { ...extra, ...read.also, [read.field]: OWNER }, true],
        [`${key}/decoy-${read.field}`, { ...extra, ...read.also, [read.field]: OTHER }, false],
      ];
    case "arrayContains":
      return [
        [`${key}/own-${read.field}`, { ...extra, [read.field]: [OWNER, OTHER] }, true],
        [`${key}/decoy-${read.field}`, { ...extra, [read.field]: [OTHER] }, false],
      ];
    case "group":
      return [
        [`${top}/p-${OWNER}/${sub}/own-${top}`, { ...extra, [read.field]: OWNER }, true],
        [`${top}/p-${OWNER}/${sub}/decoy-${top}`, { ...extra, [read.field]: OTHER }, false],
      ];
    case "underEachParent":
      return [
        [`${top}/p1`, {}, false],
        [`${top}/p1/${sub}/${OWNER}`, { ...extra, uid: OWNER }, true],
        [`${top}/p1/${sub}/${OTHER}`, { ...extra, uid: OTHER }, false],
      ];
  }
}

const SEED = INCLUDED.flatMap(([key, p]) => p.reads.flatMap((r) => seedsFor(key, r)));
const OWNED = new Set(SEED.filter(([, , own]) => own).map(([path]) => path));
const DECOYS = new Set(SEED.filter(([, , own]) => !own).map(([path]) => path));

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-user-data-export", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    for (const [path, data] of SEED) await setDoc(doc(db, path), data);
  });
});

function dbFor(uid: string): Firestore {
  return authedContext(getEnv(), uid).firestore() as unknown as Firestore;
}

/** Runs one step the way exportUserData does; returns the doc paths read. */
async function runStep(step: ExportStep): Promise<string[]> {
  if (step.type === "doc") {
    const snap = await getDocFromServer(step.ref);
    return snap.exists() ? [snap.ref.path] : [];
  }
  if (step.type === "query") return (await getDocsFromServer(step.first)).docs.map((d) => d.ref.path);
  const parents = await getDocsFromServer(step.parents);
  const out: string[] = [];
  for (const p of parents.docs) {
    const snap = await getDocFromServer(step.child(p.id));
    if (snap.exists()) out.push(snap.ref.path);
  }
  return out;
}

// Labels only: this instance never connects (the tests use dbFor instead).
const LABEL_DB = getFirestore(initializeApp({ projectId: "demo-labels" }, "export-labels"));
const OWNER_PLAN = exportReadPlan(LABEL_DB, OWNER, NAME).filter((r) => r.step);

describe("user data export reads", () => {
  it("plans a read for every included collection", () => {
    expect(OWNER_PLAN.length).toBeGreaterThan(40);
  });

  it.each(OWNER_PLAN.map((r) => r.label))("the owner can run the %s read and gets only their docs", async (label) => {
    const read = exportReadPlan(dbFor(OWNER), OWNER, NAME).find((r) => r.label === label);
    const paths = await assertSucceeds(runStep(read!.step!));
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      expect(DECOYS.has(p)).toBe(false);
      expect(OWNED.has(p)).toBe(true);
    }
  });

  it.each(["games.player1Uid", "notifications", "group:comments.userId"])(
    "the owner can page through the %s read with startAfter",
    async (label) => {
      const step = exportReadPlan(dbFor(OWNER), OWNER, NAME).find((r) => r.label === label)!.step!;
      if (step.type !== "query") throw new Error("not a query");
      // limit(1) overrides the export page size so a page boundary is crossed.
      const first = query(step.first, limit(1));
      let snap = await assertSucceeds(getDocsFromServer(first));
      const seen: string[] = [];
      while (snap.docs.length > 0) {
        seen.push(...snap.docs.map((d) => d.ref.path));
        snap = await assertSucceeds(getDocsFromServer(exportNextPage(first, snap.docs[snap.docs.length - 1])));
      }
      expect(seen.length).toBeGreaterThan(0);
    },
  );

  it("reads comments from both clips and spots in one group read", async () => {
    const step = exportReadPlan(dbFor(OWNER), OWNER, NAME).find((r) => r.label === "group:comments.userId")!.step!;
    const paths = await runStep(step);
    expect(paths.map((p) => p.split("/")[0]).sort()).toEqual(["clips", "spots"]);
  });
});

describe("someone else can't read the owner's export", () => {
  const PRIVATE = [
    "group:comments.userId",
    "group:messages.userId",
    "group:here.uid",
    "notifications",
    "users/{}/blocked_users",
    "users/{}/private",
    "reports",
    "moderationStatements",
    "appeals",
  ];

  it.each(PRIVATE)("OTHER can't run the owner's %s read", async (label) => {
    const read = exportReadPlan(dbFor(OTHER), OWNER, NAME).find((r) => r.label === label);
    expect(read?.step).toBeTruthy();
    await assertFails(runStep(read!.step!));
  });

  it.each([
    ["comments", "userId"],
    ["messages", "userId"],
    ["here", "uid"],
  ])("the %s group can't be read without the own-uid filter", async (group, field) => {
    const db = dbFor(OTHER);
    await assertFails(getDocsFromServer(query(collectionGroup(db, group), limit(10))));
    await assertFails(getDocsFromServer(query(collectionGroup(db, group), where(field, "==", OWNER), limit(10))));
    await assertFails(getDocsFromServer(query(collectionGroup(dbFor(OWNER), group), where(field, "==", OTHER))));
  });

  it("an unsigned visitor can't run a group read", async () => {
    const db = getEnv().unauthenticatedContext().firestore() as unknown as Firestore;
    await assertFails(getDocsFromServer(query(collectionGroup(db, "comments"), where("userId", "==", OWNER))));
  });
});
