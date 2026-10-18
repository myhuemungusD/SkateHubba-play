/** Announcements: anyone signed in reads; only the admin claim posts or ends. Pros get nothing. */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-announcements", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", "pro"), { isVerifiedPro: true, username: "pro" });
    await setDoc(doc(db, "announcements", "a1"), { title: "t", body: "b", audience: "all", push: false, active: true });
  });
});

const as = (uid: string, claims: Record<string, unknown> = {}) =>
  getEnv()
    .authenticatedContext(uid, { email_verified: true, ...claims })
    .firestore();
const admin = () => as("admin", { admin: true });
const ann = (by: string, extra: Record<string, unknown> = {}) => ({
  title: "Jam",
  body: "Saturday at the park",
  audience: "all",
  push: true,
  active: true,
  createdBy: by,
  createdAt: serverTimestamp(),
  ...extra,
});

describe("announcements", () => {
  it("signed-in players read; signed-out cannot", async () => {
    await assertSucceeds(getDoc(doc(as("kid"), "announcements", "a1")));
    await assertFails(getDoc(doc(getEnv().unauthenticatedContext().firestore(), "announcements", "a1")));
  });
  it("only the admin claim posts, with a valid shape", async () => {
    await assertSucceeds(setDoc(doc(admin(), "announcements", "n1"), ann("admin")));
    await assertFails(setDoc(doc(as("pro"), "announcements", "n2"), ann("pro")));
    await assertFails(setDoc(doc(as("kid"), "announcements", "n3"), ann("kid")));
    await assertFails(setDoc(doc(admin(), "announcements", "n4"), ann("someone")));
    await assertFails(setDoc(doc(admin(), "announcements", "n5"), ann("admin", { audience: "everyone" })));
    await assertFails(setDoc(doc(admin(), "announcements", "n6"), ann("admin", { title: "x".repeat(81) })));
    await assertFails(setDoc(doc(admin(), "announcements", "n7"), ann("admin", { pushStatus: "sent" })));
    await assertFails(setDoc(doc(admin(), "announcements", "n8"), ann("admin", { active: false })));
  });
  it("only the admin ends one; nothing else changes and nobody deletes", async () => {
    await assertFails(updateDoc(doc(as("pro"), "announcements", "a1"), { active: false }));
    await assertFails(updateDoc(doc(admin(), "announcements", "a1"), { title: "new" }));
    await assertFails(updateDoc(doc(admin(), "announcements", "a1"), { active: false, pushStatus: "sent" }));
    await assertSucceeds(updateDoc(doc(admin(), "announcements", "a1"), { active: false }));
    await assertFails(deleteDoc(doc(admin(), "announcements", "a1")));
  });
});
