/** config/featureTesters: only a listed uid can read it; nobody can write it from a client. */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-feature-testers", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "config", "featureTesters"), { uids: ["tester-uid"] });
  });
});

const as = (uid: string) => getEnv().authenticatedContext(uid, { email_verified: true }).firestore();

describe("config/featureTesters rules", () => {
  it("a listed tester can read it", async () => {
    await assertSucceeds(getDoc(doc(as("tester-uid"), "config", "featureTesters")));
  });

  it("everyone else is denied, including signed-out users", async () => {
    await assertFails(getDoc(doc(as("other-uid"), "config", "featureTesters")));
    await assertFails(getDoc(doc(getEnv().unauthenticatedContext().firestore(), "config", "featureTesters")));
    await assertFails(getDocs(collection(as("tester-uid"), "config")));
  });

  it("no client can write it, not even a tester", async () => {
    await assertFails(setDoc(doc(as("tester-uid"), "config", "featureTesters"), { uids: ["tester-uid", "x"] }));
    await assertFails(setDoc(doc(as("other-uid"), "config", "featureTesters"), { uids: ["other-uid"] }));
  });
});
