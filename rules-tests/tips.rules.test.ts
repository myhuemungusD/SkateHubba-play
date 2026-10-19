/**
 * Hesher tips — tipsSeen / tipsDisabled on users/{uid}/private/profile
 * (src/services/tips.ts). Run via: npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { arrayUnion, doc, setDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-tips");

function ref(as = "owner-uid") {
  return doc(
    getEnv().authenticatedContext(as, { email_verified: true }).firestore(),
    "users",
    "owner-uid",
    "private",
    "profile",
  );
}

describe("users/{uid}/private/profile — tips fields", () => {
  it("owner can add a seen tip set", async () => {
    await assertSucceeds(setDoc(ref(), { tipsSeen: arrayUnion("map") }, { merge: true }));
  });
  it("owner can switch tips off and reset", async () => {
    await assertSucceeds(setDoc(ref(), { tipsDisabled: true, tipsSeen: [] }, { merge: true }));
  });
  it("rejects a non-list tipsSeen", async () => {
    await assertFails(setDoc(ref(), { tipsSeen: "map" }, { merge: true }));
  });
  it("rejects more than 64 ids", async () => {
    await assertFails(setDoc(ref(), { tipsSeen: Array.from({ length: 65 }, (_, i) => `t${i}`) }, { merge: true }));
  });
  it("rejects a non-bool tipsDisabled", async () => {
    await assertFails(setDoc(ref(), { tipsDisabled: "yes" }, { merge: true }));
  });
  it("a stranger cannot write them", async () => {
    await assertFails(setDoc(ref("stranger-uid"), { tipsSeen: ["map"] }, { merge: true }));
  });
});
