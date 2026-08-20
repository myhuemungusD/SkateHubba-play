/**
 * users/{uid}.banned — admin-only moderation flag.
 *
 * The flag is the kill switch for UGC writes (user clips, clip votes, clip
 * comments), so a self-serve write to it would defeat moderation entirely.
 * Mirrors the Verified-Pro admin clause: admin claim required, hasOnly
 * pinned to the single field, and NO self-write (a compromised admin token
 * must not be able to unban itself).
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const TARGET = "u-target";
const ADMIN = "u-admin";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-users-banned", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", TARGET), { uid: TARGET, username: "target", banned: false });
    await setDoc(doc(ctx.firestore(), "users", ADMIN), { uid: ADMIN, username: "admin", banned: false });
  });
});

function adminCtx(): RulesTestContext {
  return getEnv().authenticatedContext(ADMIN, { email_verified: true, admin: true });
}

function userCtx(uid: string): RulesTestContext {
  return getEnv().authenticatedContext(uid, { email_verified: true });
}

function userRef(ctx: RulesTestContext, uid: string) {
  return doc(ctx.firestore(), "users", uid);
}

describe("users.banned — admin-only", () => {
  it("an admin CAN ban another user", async () => {
    await assertSucceeds(updateDoc(userRef(adminCtx(), TARGET), { banned: true }));
  });

  it("an admin CAN unban another user", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", TARGET), { uid: TARGET, username: "target", banned: true });
    });
    await assertSucceeds(updateDoc(userRef(adminCtx(), TARGET), { banned: false }));
  });

  it("attack: a normal user CANNOT ban someone else", async () => {
    await assertFails(updateDoc(userRef(userCtx(ADMIN), TARGET), { banned: true }));
  });

  it("attack: a user CANNOT self-unban", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", TARGET), { uid: TARGET, username: "target", banned: true });
    });
    await assertFails(updateDoc(userRef(userCtx(TARGET), TARGET), { banned: false }));
  });

  it("attack: a user CANNOT clear the flag by omitting it in a merge write", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", TARGET), { uid: TARGET, username: "target", banned: true });
    });
    // A full overwrite that simply drops `banned` still shows up in
    // affectedKeys() — the immutable backstop denies it.
    await assertFails(setDoc(userRef(userCtx(TARGET), TARGET), { uid: TARGET, username: "target" }));
  });

  it("attack: an ADMIN cannot unban THEMSELVES (four-eyes)", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", ADMIN), { uid: ADMIN, username: "admin", banned: true });
    });
    await assertFails(updateDoc(userRef(adminCtx(), ADMIN), { banned: false }));
  });

  it("attack: an admin cannot ride a username rewrite along with a ban", async () => {
    await assertFails(updateDoc(userRef(adminCtx(), TARGET), { banned: true, username: "seized" }));
  });

  it("attack: a non-bool banned value is rejected", async () => {
    await assertFails(updateDoc(userRef(adminCtx(), TARGET), { banned: "true" }));
  });

  it("attack: banned cannot be seeded at profile-create time", async () => {
    const ctx = userCtx("u-fresh");
    await assertFails(setDoc(userRef(ctx, "u-fresh"), { uid: "u-fresh", username: "fresh", banned: false }));
    await assertSucceeds(setDoc(userRef(ctx, "u-fresh"), { uid: "u-fresh", username: "fresh" }));
  });

  it("a banned user can still edit unrelated profile fields (ban gates writes, not identity)", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", TARGET), { uid: TARGET, username: "target", banned: true });
    });
    await assertSucceeds(updateDoc(userRef(userCtx(TARGET), TARGET), { stance: "goofy" }));
  });
});
