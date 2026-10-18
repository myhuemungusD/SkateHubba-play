/** Admin ops: adminAudit append-only log + disputes adminRuling. Admin claim only; pros never. */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-admin-ops", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "disputes", "g1_1"), {
      status: "open",
      moderationStatus: "active",
      landVotes: 1,
      bailVotes: 0,
    });
    await setDoc(doc(db, "disputes", "g2_1"), {
      status: "closed",
      moderationStatus: "active",
      landVotes: 1,
      bailVotes: 0,
    });
    await setDoc(doc(db, "adminAudit", "e1"), {
      adminUid: "admin",
      action: "ban",
      targetId: "u",
      detail: "",
      at: new Date(),
    });
  });
});

const admin = () => getEnv().authenticatedContext("admin", { email_verified: true, admin: true }).firestore();
const pro = () => getEnv().authenticatedContext("pro", { email_verified: true }).firestore();
const entry = (uid: string, extra: Record<string, unknown> = {}) => ({
  adminUid: uid,
  action: "ban",
  targetId: "u1",
  detail: "spam",
  at: serverTimestamp(),
  ...extra,
});
const ruling = (uid: string, r = "land") => ({ adminRuling: r, adminRuledBy: uid, adminRuledAt: serverTimestamp() });

describe("adminAudit rules", () => {
  it("an admin appends and reads; cannot edit or delete", async () => {
    await assertSucceeds(addDoc(collection(admin(), "adminAudit"), entry("admin")));
    await assertSucceeds(getDoc(doc(admin(), "adminAudit", "e1")));
    await assertFails(updateDoc(doc(admin(), "adminAudit", "e1"), { detail: "x" }));
    await assertFails(deleteDoc(doc(admin(), "adminAudit", "e1")));
  });
  it("rejects impersonation, extra keys and non-admins", async () => {
    await assertFails(addDoc(collection(admin(), "adminAudit"), entry("someone")));
    await assertFails(addDoc(collection(admin(), "adminAudit"), entry("admin", { extra: 1 })));
    await assertFails(addDoc(collection(pro(), "adminAudit"), entry("pro")));
    await assertFails(getDoc(doc(pro(), "adminAudit", "e1")));
  });
});

describe("disputes adminRuling rules", () => {
  it("a pro cannot rule", async () => {
    await assertFails(updateDoc(doc(pro(), "disputes", "g1_1"), ruling("pro")));
  });
  it("an admin rules once on an open dispute, stamped as themselves", async () => {
    await assertFails(updateDoc(doc(admin(), "disputes", "g1_1"), ruling("other")));
    await assertFails(updateDoc(doc(admin(), "disputes", "g1_1"), ruling("admin", "tie")));
    await assertFails(updateDoc(doc(admin(), "disputes", "g1_1"), { ...ruling("admin"), landVotes: 9 }));
    await assertFails(updateDoc(doc(admin(), "disputes", "g2_1"), ruling("admin")));
    await assertSucceeds(updateDoc(doc(admin(), "disputes", "g1_1"), ruling("admin")));
    await assertFails(updateDoc(doc(admin(), "disputes", "g1_1"), ruling("admin", "bail")));
  });
});
