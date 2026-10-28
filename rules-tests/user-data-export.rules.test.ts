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
 * owner, one decoy for OTHER), plus a read's fixed filters (`also`).
 * Fake uids only.
 *
 * (The emulator doesn't enforce composite indexes, so the "equality filters
 * only" half is pinned in src/services/__tests__/userData.test.ts.)
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection,
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
import { exportNextPage, exportReadPlan, readTag, type ExportStep } from "../src/services/userDataQueries";

const OWNER = "export-owner";
const OTHER = "export-other";
const NAME = "export-owner-name";

const INCLUDED = Object.entries(FIRESTORE_EXPORT).filter((e): e is [string, ExportIncluded] => "section" in e[1]);

/** [path, data, ownedByOwner] seeds for one read of one registry key. */
function seedsFor(key: string, read: ExportRead): Array<[string, Record<string, unknown>, boolean]> {
  const [top, , sub] = key.split("/");
  switch (read.kind) {
    case "uidDoc":
      return [
        [`${key}/${OWNER}`, { uid: OWNER }, true],
        [`${key}/${OTHER}`, { uid: OTHER }, false],
      ];
    case "ownDoc":
      return [[`users/${OWNER}/${sub}/${read.id}`, {}, true]];
    case "ownList":
      return [
        [`users/${OWNER}/${sub}/own-1`, {}, true],
        [`users/${OTHER}/${sub}/decoy-1`, {}, false],
      ];
    case "usernameDoc":
      return [[`${key}/${NAME}`, { uid: OWNER }, true]];
    case "where":
      // readTag keeps two reads on one field apart (spots: isActive true/false).
      return [
        [`${key}/own-${readTag(read)}`, { ...read.also, [read.field]: OWNER }, true],
        [`${key}/decoy-${readTag(read)}`, { ...read.also, [read.field]: OTHER }, false],
      ];
    case "arrayContains":
      return [
        [`${key}/own-${read.field}`, { [read.field]: [OWNER, OTHER] }, true],
        [`${key}/decoy-${read.field}`, { [read.field]: [OTHER] }, false],
      ];
    case "group":
      return [
        [`${top}/p-${OWNER}/${sub}/own-${top}`, { [read.field]: OWNER }, true],
        [`${top}/p-${OWNER}/${sub}/decoy-${top}`, { [read.field]: OTHER }, false],
      ];
    case "underEachParent":
      return [
        [`${top}/p1`, {}, false],
        [`${top}/p1/${sub}/${OWNER}`, { uid: OWNER }, true],
        [`${top}/p1/${sub}/${OTHER}`, { uid: OTHER }, false],
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

  it.each(["games.player1Uid", "notifications", "group:comments.userId", "spots.createdBy.isActive=false"])(
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
    "spots.createdBy.isActive=false",
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

describe("spots the owner created (#910 creator rule)", () => {
  const ACTIVE = "spots/own-createdBy.isActive=true";
  const INACTIVE = "spots/own-createdBy.isActive=false";
  const OTHERS_INACTIVE = "spots/decoy-createdBy.isActive=false";

  it("the export reads the owner's active and deactivated spots into one section", async () => {
    const reads = exportReadPlan(dbFor(OWNER), OWNER, NAME).filter((r) => r.section === "spots");
    expect(reads.map((r) => r.label)).toEqual(["spots.createdBy.isActive=true", "spots.createdBy.isActive=false"]);
    const paths = (await Promise.all(reads.map((r) => assertSucceeds(runStep(r.step!))))).flat();
    expect(paths.sort()).toEqual([INACTIVE, ACTIVE].sort());
  });

  it("the creator can read their own inactive spot by id", async () => {
    const snap = await assertSucceeds(getDocFromServer(doc(dbFor(OWNER), INACTIVE)));
    expect(snap.data()).toMatchObject({ createdBy: OWNER, isActive: false });
  });

  it("someone else can't read the owner's inactive spot, by id or by an unfiltered query", async () => {
    await assertFails(getDocFromServer(doc(dbFor(OTHER), INACTIVE)));
    await assertFails(
      getDocsFromServer(query(collection(dbFor(OTHER), "spots"), where("createdBy", "==", OWNER), limit(500))),
    );
  });

  it("the owner can't read someone else's inactive spot", async () => {
    await assertFails(getDocFromServer(doc(dbFor(OWNER), OTHERS_INACTIVE)));
    await assertFails(
      getDocsFromServer(query(collection(dbFor(OWNER), "spots"), where("isActive", "==", false), limit(500))),
    );
  });

  it("anyone signed in can still run the owner's active-spots read", async () => {
    const read = exportReadPlan(dbFor(OTHER), OWNER, NAME).find((r) => r.label === "spots.createdBy.isActive=true");
    expect(await assertSucceeds(runStep(read!.step!))).toEqual([ACTIVE]);
  });
});
