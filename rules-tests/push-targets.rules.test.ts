/**
 * pushTargets/{uid} — cross-readable FCM token mirror.
 *
 * Red-team the new collection introduced for the firestore-send-fcm
 * dispatch pipeline. The canonical fcmTokens list stays at
 * users/{uid}/private/profile (owner-only); this mirror exists so a SENDER
 * can embed the recipient's tokens into a /push_dispatch doc. The privacy
 * regression is bounded — FCM tokens alone cannot be turned into a push
 * attack without server credentials — but the writer rules must still
 * prevent cross-user tampering and unbounded fan-out.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-pushtargets-redteam";

const OWNER_UID = "owner-uid";
const OTHER_UID = "other-uid";

const getEnv = setupRulesTestEnv(PROJECT_ID);

function asUser(uid: string): RulesTestContext {
  return getEnv().authenticatedContext(uid, { email_verified: true });
}

function validMirror(tokens: string[] = ["t1"]): Record<string, unknown> {
  return { tokens, updatedAt: serverTimestamp() };
}

describe("pushTargets — owner writes", () => {
  it("legitimate: owner can create their own mirror with ≤10 tokens and server time", async () => {
    await assertSucceeds(setDoc(doc(asUser(OWNER_UID).firestore(), "pushTargets", OWNER_UID), validMirror()));
  });

  it("legitimate: owner can update their mirror (arrayUnion semantics resolve server-side)", async () => {
    await assertSucceeds(setDoc(doc(asUser(OWNER_UID).firestore(), "pushTargets", OWNER_UID), validMirror(["t1"])));
    await assertSucceeds(
      setDoc(doc(asUser(OWNER_UID).firestore(), "pushTargets", OWNER_UID), validMirror(["t1", "t2"])),
    );
  });

  it("legitimate: owner can delete their own mirror (account-deletion path)", async () => {
    await setDoc(doc(asUser(OWNER_UID).firestore(), "pushTargets", OWNER_UID), validMirror());
    const { deleteDoc } = await import("firebase/firestore");
    await assertSucceeds(deleteDoc(doc(asUser(OWNER_UID).firestore(), "pushTargets", OWNER_UID)));
  });

  it("attack: another signed-in user CANNOT write someone else's mirror", async () => {
    await assertFails(setDoc(doc(asUser(OTHER_UID).firestore(), "pushTargets", OWNER_UID), validMirror()));
  });

  it("attack: owner CANNOT exceed the 10-token cap (11 entries rejected)", async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `t${i}`);
    await assertFails(setDoc(doc(asUser(OWNER_UID).firestore(), "pushTargets", OWNER_UID), validMirror(tooMany)));
  });

  it("attack: owner CANNOT backfill updatedAt with a stale timestamp", async () => {
    // Without the pinned server-time check the Extension's stale-mirror
    // skip logic (it uses updatedAt to discard long-revoked entries on
    // 404) could be defeated by writing a future timestamp.
    await assertFails(
      setDoc(doc(asUser(OWNER_UID).firestore(), "pushTargets", OWNER_UID), {
        tokens: ["t1"],
        updatedAt: Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000),
      }),
    );
  });

  it("attack: owner CANNOT add unknown keys (allowlist enforcement)", async () => {
    await assertFails(
      setDoc(doc(asUser(OWNER_UID).firestore(), "pushTargets", OWNER_UID), {
        ...validMirror(),
        smuggled: "payload",
      }),
    );
  });
});

describe("pushTargets — platform tags (dice stays off iPhones)", () => {
  const mirrorRef = () => doc(asUser(OWNER_UID).firestore(), "pushTargets", OWNER_UID);

  it("legitimate: a token can be registered with its platform tag", async () => {
    await assertSucceeds(
      setDoc(
        mirrorRef(),
        { tokens: arrayUnion("t1"), platforms: { t1: "ios" }, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
    await assertSucceeds(
      setDoc(
        mirrorRef(),
        { tokens: arrayUnion("t2"), platforms: { t2: "web" }, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
  });

  it("legitimate: a token and its tag can be removed together, and all tags cleared", async () => {
    await setDoc(mirrorRef(), {
      tokens: ["t1", "t2"],
      platforms: { t1: "android", t2: "web" },
      updatedAt: serverTimestamp(),
    });
    await assertSucceeds(
      setDoc(
        mirrorRef(),
        { tokens: arrayRemove("t1"), platforms: { t1: deleteField() }, updatedAt: serverTimestamp() },
        { merge: true },
      ),
    );
    await assertSucceeds(
      setDoc(mirrorRef(), { tokens: [], platforms: deleteField(), updatedAt: serverTimestamp() }, { merge: true }),
    );
  });

  it("legitimate: an older build that only touches tokens still works on a tagged mirror", async () => {
    await setDoc(mirrorRef(), { tokens: ["t1"], platforms: { t1: "web" }, updatedAt: serverTimestamp() });
    await assertSucceeds(
      setDoc(mirrorRef(), { tokens: arrayRemove("t1"), updatedAt: serverTimestamp() }, { merge: true }),
    );
  });

  it("attack: owner CANNOT tag a token with an unknown platform", async () => {
    await assertFails(setDoc(mirrorRef(), { ...validMirror(), platforms: { t1: "watch" } }));
    await assertFails(setDoc(mirrorRef(), { ...validMirror(), platforms: { t1: 1 } }));
  });

  it("attack: owner CANNOT store platforms as anything but a map, or grow it past 20", async () => {
    await assertFails(setDoc(mirrorRef(), { ...validMirror(), platforms: ["ios"] }));
    const many = Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`t${i}`, "web"]));
    await assertFails(setDoc(mirrorRef(), { ...validMirror(), platforms: many }));
  });
});

describe("pushTargets — reads", () => {
  it("legitimate: any signed-in user can read another user's mirror", async () => {
    // The whole point of the mirror is cross-user readability so a sender
    // can embed the recipient's tokens in a /push_dispatch doc.
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "pushTargets", OWNER_UID), {
        tokens: ["t1"],
        updatedAt: serverTimestamp(),
      });
    });
    await assertSucceeds(getDoc(doc(asUser(OTHER_UID).firestore(), "pushTargets", OWNER_UID)));
  });

  it("attack: unauthenticated readers cannot read", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "pushTargets", OWNER_UID), {
        tokens: ["t1"],
        updatedAt: serverTimestamp(),
      });
    });
    await assertFails(getDoc(doc(getEnv().unauthenticatedContext().firestore(), "pushTargets", OWNER_UID)));
  });

  it("attack: a signed-in user CANNOT list every user's mirror (token dump)", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "pushTargets", OWNER_UID), { tokens: ["t1"], updatedAt: Timestamp.now() });
    });
    await assertFails(getDocs(collection(asUser(OTHER_UID).firestore(), "pushTargets")));
  });
});
