/**
 * Economy Phase A — public reputation read posture for the two profile
 * display subcollections:
 *
 *   users/{uid}/achievements/{achievementId}   (badges)
 *   users/{uid}/locker/{itemId}                (owned gear / cosmetics)
 *
 * Both are rendered on ANOTHER skater's public profile (/player/:uid), so READ
 * widened from owner-only to any signed-in user. Everything else stays locked
 * down: items and badges are minted exclusively by the Admin SDK (a client
 * that can mint gear has no economy), and only the owner may DELETE — the
 * account-deletion batch in src/services/users.ts needs that to stay atomic.
 *
 * Verifies:
 *  - signed-in NON-owner CAN read another user's achievement + locker docs
 *  - anonymous CANNOT read either
 *  - client create/update denied on both, even for the owner
 *  - owner CAN delete their own locker doc; a stranger CANNOT
 *
 * Run via:  npm run test:rules
 */
import { describe, it, expect } from "vitest";
import { assertSucceeds, assertFails, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, deleteDoc, updateDoc, type DocumentReference } from "firebase/firestore";
import { setupRulesTestEnv, authedContext } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-locker-achievements";

const PROFILE_UID = "profile-owner-uid";
const VIEWER_UID = "viewer-uid";
const BADGE_ID = "hundred-clips";
const ITEM_ID = "og-deck";

/**
 * The two public-reputation subcollections under a single user, exercised with
 * identical expectations. Kept as a table so every case below runs against
 * BOTH paths — a rule that drifts on one of them fails loudly.
 */
const SUBCOLLECTIONS = [
  { name: "achievements", collection: "achievements", docId: BADGE_ID },
  { name: "locker", collection: "locker", docId: ITEM_ID },
] as const;

/** Server-authored payload shape (Admin SDK mints these; clients never do). */
function mintedPayload(collection: string, docId: string): Record<string, unknown> {
  return { id: docId, kind: collection, grantedAt: new Date(), source: "server" };
}

const getEnv = setupRulesTestEnv(PROJECT_ID, async (env: RulesTestEnvironment) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const { collection, docId } of SUBCOLLECTIONS) {
      await setDoc(doc(ctx.firestore(), "users", PROFILE_UID, collection, docId), mintedPayload(collection, docId));
    }
  });
});

/** Reference the seeded doc as an arbitrary caller context. */
function refAs(uid: string | null, collection: string, docId: string): DocumentReference {
  const env = getEnv();
  const ctx = uid === null ? env.unauthenticatedContext() : authedContext(env, uid);
  return doc(ctx.firestore(), "users", PROFILE_UID, collection, docId);
}

describe.each(SUBCOLLECTIONS)("users/{uid}/$name — public reputation reads", ({ collection, docId }) => {
  it("signed-in non-owner CAN read it (rendered on /player/:uid)", async () => {
    const snap = await assertSucceeds(getDoc(refAs(VIEWER_UID, collection, docId)));
    expect(snap.exists()).toBe(true);
  });

  it("the owner CAN still read it", async () => {
    await assertSucceeds(getDoc(refAs(PROFILE_UID, collection, docId)));
  });

  it("anonymous CANNOT read it", async () => {
    await assertFails(getDoc(refAs(null, collection, docId)));
  });
});

describe.each(SUBCOLLECTIONS)("users/{uid}/$name — mint denied (Admin SDK only)", ({ collection, docId }) => {
  it("owner CANNOT create a doc", async () => {
    const fresh = `${docId}-forged`;
    await assertFails(setDoc(refAs(PROFILE_UID, collection, fresh), mintedPayload(collection, fresh)));
  });

  it("owner CANNOT update the seeded doc", async () => {
    await assertFails(updateDoc(refAs(PROFILE_UID, collection, docId), { source: "client" }));
  });

  it("signed-in stranger CANNOT create a doc on someone else's profile", async () => {
    const fresh = `${docId}-injected`;
    await assertFails(setDoc(refAs(VIEWER_UID, collection, fresh), mintedPayload(collection, fresh)));
  });
});

describe("users/{uid}/locker — delete stays owner-only", () => {
  it("owner CAN delete their own locker item (account-deletion batch)", async () => {
    await assertSucceeds(deleteDoc(refAs(PROFILE_UID, "locker", ITEM_ID)));
  });

  it("signed-in stranger CANNOT delete someone else's locker item", async () => {
    await assertFails(deleteDoc(refAs(VIEWER_UID, "locker", ITEM_ID)));
  });

  it("anonymous CANNOT delete a locker item", async () => {
    await assertFails(deleteDoc(refAs(null, "locker", ITEM_ID)));
  });
});
