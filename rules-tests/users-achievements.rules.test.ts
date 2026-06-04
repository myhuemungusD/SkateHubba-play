/**
 * Users achievements subcollection rules (P0/P1 coverage hole).
 *
 * `users/{uid}/achievements/*` had NO rule before this change, so under the
 * default-deny posture the owner could not READ them (badge display) or
 * DELETE them — which silently broke the atomic account-deletion batch in
 * src/services/users.ts (~345-353), i.e. GDPR/CCPA erasure.
 *
 * The rule grants the owner read + delete, and denies client create/update
 * outright (achievements are minted server-side via the Admin SDK only).
 *
 * Verifies:
 *  - owner CAN read + delete their own achievement docs
 *  - non-owner CANNOT read or delete
 *  - client create/update denied even for the owner
 *  - anonymous denied
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
import { doc, getDoc, setDoc, deleteDoc, updateDoc, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-users-achievements";

const OWNER_UID = "owner-uid";
const STRANGER_UID = "stranger-uid";
const ACH_ID = "first-game-win";

let testEnv: RulesTestEnvironment;

function asOwner(): RulesTestContext {
  return testEnv.authenticatedContext(OWNER_UID, { email_verified: true });
}

function asStranger(): RulesTestContext {
  return testEnv.authenticatedContext(STRANGER_UID, { email_verified: true });
}

function achPath(uid: string = OWNER_UID, id: string = ACH_ID): [string, string, string, string] {
  return ["users", uid, "achievements", id];
}

/** Seed an achievement doc the way the Admin SDK would (rules disabled). */
async function seedAchievement(uid: string = OWNER_UID, id: string = ACH_ID): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), ...achPath(uid, id)), {
      achievementId: id,
      awardedAt: new Date(),
      label: "First Win",
    });
  });
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

describe("users/{uid}/achievements — owner read + delete (GDPR erasure)", () => {
  it("owner CAN read their own achievement doc", async () => {
    await seedAchievement();
    await assertSucceeds(getDoc(doc(asOwner().firestore(), ...achPath())));
  });

  it("owner CAN delete their own achievement doc (account-deletion batch)", async () => {
    await seedAchievement();
    await assertSucceeds(deleteDoc(doc(asOwner().firestore(), ...achPath())));
  });
});

describe("users/{uid}/achievements — non-owner + anonymous denied", () => {
  it("stranger CANNOT read another user's achievement doc", async () => {
    await seedAchievement();
    await assertFails(getDoc(doc(asStranger().firestore(), ...achPath())));
  });

  it("stranger CANNOT delete another user's achievement doc", async () => {
    await seedAchievement();
    await assertFails(deleteDoc(doc(asStranger().firestore(), ...achPath())));
  });

  it("anonymous CANNOT read an achievement doc", async () => {
    await seedAchievement();
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), ...achPath())));
  });
});

describe("users/{uid}/achievements — client create/update denied (Admin-SDK only)", () => {
  it("owner CANNOT create an achievement doc (no self-minting)", async () => {
    await assertFails(
      setDoc(doc(asOwner().firestore(), ...achPath()), {
        achievementId: ACH_ID,
        awardedAt: new Date(),
        label: "Forged Badge",
      }),
    );
  });

  it("owner CANNOT update an existing achievement doc", async () => {
    await seedAchievement();
    await assertFails(updateDoc(doc(asOwner().firestore(), ...achPath()), { label: "Tampered" }));
  });
});
