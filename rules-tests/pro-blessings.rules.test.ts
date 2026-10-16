/**
 * Pro blessings are server-written. A pro badge can never be earned, won or
 * self-granted: no client (not even a verified pro) can write isVerifiedPro
 * on any user doc or touch /proBlessings. Accepted lineage is public;
 * pending and declined offers stay between the two skaters and admins.
 */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-pro-blessings");
const PRO = "bless-pro";
const SK8 = "bless-sk8";
const STRANGER = "bless-stranger";

async function seed(): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", PRO), { uid: PRO, username: "bryanherman", isVerifiedPro: true });
    await setDoc(doc(db, "users", SK8), { uid: SK8, username: "rookie" });
    const base = { blesserUid: PRO, targetUid: SK8, reason: "Real deal ripper.", createdAt: 1 };
    await setDoc(doc(db, "proBlessings", "accepted"), { ...base, status: "accepted" });
    await setDoc(doc(db, "proBlessings", "pending"), { ...base, status: "pending" });
  });
}

describe("proBlessings", () => {
  it("accepted lineage is public; pending is only for the two skaters", async () => {
    await seed();
    const env = getEnv();
    await assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), "proBlessings", "accepted")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "proBlessings", "pending")));
    await assertFails(getDoc(doc(env.authenticatedContext(STRANGER).firestore(), "proBlessings", "pending")));
    await assertSucceeds(getDoc(doc(env.authenticatedContext(SK8).firestore(), "proBlessings", "pending")));
    await assertSucceeds(getDoc(doc(env.authenticatedContext(PRO).firestore(), "proBlessings", "pending")));
    await assertSucceeds(
      getDoc(doc(env.authenticatedContext("adm", { admin: true }).firestore(), "proBlessings", "pending")),
    );
    const mine = query(
      collection(env.authenticatedContext(SK8).firestore(), "proBlessings"),
      where("targetUid", "==", SK8),
      where("status", "==", "pending"),
    );
    await assertSucceeds(getDocs(mine));
    const lineage = query(
      collection(env.unauthenticatedContext().firestore(), "proBlessings"),
      where("targetUid", "==", SK8),
      where("status", "==", "accepted"),
    );
    await assertSucceeds(getDocs(lineage));
  });

  it("denies every client write, including the blesser, the target and admins", async () => {
    await seed();
    const env = getEnv();
    for (const ctx of [
      env.authenticatedContext(PRO),
      env.authenticatedContext(SK8),
      env.authenticatedContext("adm", { admin: true }),
    ]) {
      const db = ctx.firestore();
      await assertFails(
        setDoc(doc(db, "proBlessings", "new"), { blesserUid: PRO, targetUid: SK8, status: "accepted" }),
      );
      await assertFails(updateDoc(doc(db, "proBlessings", "pending"), { status: "accepted" }));
      await assertFails(deleteDoc(doc(db, "proBlessings", "accepted")));
    }
  });
});

describe("isVerifiedPro cannot be earned or self-granted", () => {
  it("a skater cannot make themselves pro", async () => {
    await seed();
    const db = getEnv().authenticatedContext(SK8).firestore();
    await assertFails(updateDoc(doc(db, "users", SK8), { isVerifiedPro: true }));
    await assertFails(updateDoc(doc(db, "users", SK8), { isVerifiedPro: true, verifiedBy: PRO }));
  });

  it("a verified pro cannot write pro onto someone else (blessing goes through the callable)", async () => {
    await seed();
    const db = getEnv().authenticatedContext(PRO).firestore();
    await assertFails(updateDoc(doc(db, "users", SK8), { isVerifiedPro: true, verifiedBy: PRO }));
  });
});
