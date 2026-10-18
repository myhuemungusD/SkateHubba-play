/** Pro review queue + gold authoring: verified pros only, one call per clip; admins get no pro write. */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, doc, getDoc, getDocs, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-pro-calls", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", "pro"), { isVerifiedPro: true });
    await setDoc(doc(db, "users", "kid"), { isVerifiedPro: false });
    await setDoc(doc(db, "wttItems", "q1"), { status: "pro_queue", options: ["kickflip"] });
    await setDoc(doc(db, "wttItems", "o1"), { status: "open", options: ["kickflip"] });
  });
});

const as = (uid: string, claims: Record<string, unknown> = {}) =>
  getEnv()
    .authenticatedContext(uid, { email_verified: true, ...claims })
    .firestore();
const review = (uid: string, clipId = "q1") => ({
  clipId,
  uid,
  answerTrickId: "kickflip",
  createdAt: serverTimestamp(),
});

describe("pro calls rules", () => {
  it("only verified pros read the pro queue", async () => {
    await assertSucceeds(getDoc(doc(as("pro"), "wttItems", "q1")));
    await assertSucceeds(getDocs(query(collection(as("pro"), "wttItems"), where("status", "==", "pro_queue"))));
    await assertFails(getDoc(doc(as("kid"), "wttItems", "q1")));
    await assertFails(getDoc(doc(as("admin", { admin: true }), "wttItems", "q1")));
    await assertSucceeds(getDoc(doc(as("kid"), "wttItems", "o1")));
  });
  it("a pro reviews once per clip under a deterministic id", async () => {
    await assertFails(setDoc(doc(as("pro"), "proReviews", "random"), review("pro")));
    await assertFails(setDoc(doc(as("pro"), "proReviews", "nope_pro"), review("pro", "nope")));
    await assertSucceeds(setDoc(doc(as("pro"), "proReviews", "q1_pro"), review("pro")));
    await assertFails(setDoc(doc(as("pro"), "proReviews", "q1_pro"), review("pro")));
    await assertFails(setDoc(doc(as("kid"), "proReviews", "q1_kid"), review("kid")));
    await assertFails(setDoc(doc(as("admin", { admin: true }), "proReviews", "q1_admin"), review("admin")));
  });
  it("a pro marks gold once; nobody reads it", async () => {
    await assertFails(setDoc(doc(as("kid"), "proGold", "o1"), review("kid", "o1")));
    await assertFails(setDoc(doc(as("pro"), "proGold", "o1"), review("pro", "q1")));
    await assertFails(setDoc(doc(as("pro"), "proGold", "zz"), review("pro", "zz")));
    await assertSucceeds(setDoc(doc(as("pro"), "proGold", "o1"), review("pro", "o1")));
    await assertFails(setDoc(doc(as("pro"), "proGold", "o1"), review("pro", "o1")));
    await assertFails(getDoc(doc(as("pro"), "proGold", "o1")));
  });
});
