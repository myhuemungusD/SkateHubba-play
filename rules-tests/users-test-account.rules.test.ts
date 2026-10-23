/**
 * users/{uid}.isTestAccount — the QA/test-account marker that keeps internal
 * accounts out of the public player lists (directory, opponent pickers,
 * leaderboard).
 *
 * Only the Admin SDK may write it (scripts/set-test-account.mjs). Clients,
 * the owner and the admin-claim client branches included, can never set,
 * change or clear it, so a real player cannot hide from the lists and a test
 * account cannot un-hide itself.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds, type RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { deleteField, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { seedUsernameReservation, setupRulesTestEnv } from "./_fixtures";

const OWNER = "owner-uid";
const OTHER = "other-uid";
const ADMIN = "admin-uid";

async function seedProfile(env: RulesTestEnvironment, uid: string, extra: Record<string, unknown> = {}): Promise<void> {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", uid), {
      uid,
      username: uid.replace("-uid", ""),
      stance: "Regular",
      ...extra,
    });
  });
}

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-users-test-account");

function owner(env: RulesTestEnvironment) {
  return env.authenticatedContext(OWNER, { email_verified: true }).firestore();
}

describe("users/{uid}.isTestAccount — create", () => {
  const newProfile = (extra: Record<string, unknown> = {}) => ({
    uid: OWNER,
    username: "owner",
    stance: "Regular",
    createdAt: serverTimestamp(),
    ...extra,
  });

  it("control: a normal signup without the flag succeeds", async () => {
    const env = getEnv();
    await seedUsernameReservation(env, OWNER, "owner");
    await assertSucceeds(setDoc(doc(owner(env), "users", OWNER), newProfile()));
  });

  it("attack: a signup cannot mark itself a test account", async () => {
    const env = getEnv();
    await seedUsernameReservation(env, OWNER, "owner");
    await assertFails(setDoc(doc(owner(env), "users", OWNER), newProfile({ isTestAccount: true })));
  });

  it("attack: a signup cannot seed the flag as false either", async () => {
    const env = getEnv();
    await seedUsernameReservation(env, OWNER, "owner");
    await assertFails(setDoc(doc(owner(env), "users", OWNER), newProfile({ isTestAccount: false })));
  });
});

describe("users/{uid}.isTestAccount — update", () => {
  it("attack: the owner cannot set the flag on their own profile", async () => {
    const env = getEnv();
    await seedProfile(env, OWNER);
    await assertFails(updateDoc(doc(owner(env), "users", OWNER), { isTestAccount: true }));
  });

  it("attack: a flagged owner cannot clear the flag (false or delete)", async () => {
    const env = getEnv();
    await seedProfile(env, OWNER, { isTestAccount: true });
    await assertFails(updateDoc(doc(owner(env), "users", OWNER), { isTestAccount: false }));
    await assertFails(updateDoc(doc(owner(env), "users", OWNER), { isTestAccount: deleteField() }));
  });

  it("a flagged owner can still edit an ordinary field", async () => {
    const env = getEnv();
    await seedProfile(env, OWNER, { isTestAccount: true });
    await assertSucceeds(updateDoc(doc(owner(env), "users", OWNER), { stance: "Goofy" }));
  });

  it("attack: another player cannot flag someone else", async () => {
    const env = getEnv();
    await seedProfile(env, OWNER);
    const other = env.authenticatedContext(OTHER, { email_verified: true }).firestore();
    await assertFails(updateDoc(doc(other, "users", OWNER), { isTestAccount: true }));
  });

  it("attack: an admin-claim client cannot set it either (Admin SDK only)", async () => {
    const env = getEnv();
    await seedProfile(env, OWNER);
    const admin = env.authenticatedContext(ADMIN, { email_verified: true, admin: true }).firestore();
    await assertFails(updateDoc(doc(admin, "users", OWNER), { isTestAccount: true }));
  });
});
