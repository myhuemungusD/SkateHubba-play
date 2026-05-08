/**
 * Firestore rules tests for the `profileImageUrl` validator on
 * `users/{uid}` updates (PR-B, plan §4.5).
 *
 * Verifies:
 *  - own UID URL allowed
 *  - other user's UID URL denied (audit S12, anti-phishing)
 *  - malformed URL denied
 *  - null allowed
 *  - non-bucket URL denied (audit S5, bucket pinning)
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const PROD_BUCKET = "sk8hub-d7806.firebasestorage.app";
const OWNER_UID = "owner-uid";
const OTHER_UID = "other-uid";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-avatar-firestore", async (env) => {
  // Seed both profiles via security-disabled context so the update-rule
  // tests have something to mutate.
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", OWNER_UID), {
      uid: OWNER_UID,
      username: "owner",
      stance: "Regular",
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(db, "users", OTHER_UID), {
      uid: OTHER_UID,
      username: "other",
      stance: "Goofy",
      createdAt: serverTimestamp(),
    });
  });
});

function asOwner(): RulesTestContext {
  return getEnv().authenticatedContext(OWNER_UID, { email_verified: true });
}

function buildUrl(uid: string, ext = "webp", bucket = PROD_BUCKET): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/users%2F${uid}%2Favatar.${ext}?alt=media&token=abc`;
}

describe("avatar Firestore rule — profileImageUrl pinning", () => {
  it("allows the owner to set their own UID's avatar URL", async () => {
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        profileImageUrl: buildUrl(OWNER_UID, "webp"),
      }),
    );
  });

  it("denies setting a URL whose UID segment points at another user (audit S12)", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        profileImageUrl: buildUrl(OTHER_UID, "webp"),
      }),
    );
  });

  it("denies a malformed URL (no https, wrong host, missing path)", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        profileImageUrl: "http://evil.example.com/avatar.webp",
      }),
    );
  });

  it("allows clearing the avatar with an explicit null", async () => {
    await assertSucceeds(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        profileImageUrl: null,
      }),
    );
  });

  it("denies a URL pointing at a non-project bucket (audit S5)", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        profileImageUrl: buildUrl(OWNER_UID, "webp", "attacker-bucket.firebasestorage.app"),
      }),
    );
  });

  it("denies a URL with an extension outside the (webp|jpeg|png) allowlist", async () => {
    await assertFails(
      updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
        profileImageUrl: buildUrl(OWNER_UID, "gif"),
      }),
    );
  });

  it("allows webp / jpeg / png variants for the owner's own UID", async () => {
    for (const ext of ["webp", "jpeg", "png"] as const) {
      await assertSucceeds(
        updateDoc(doc(asOwner().firestore(), "users", OWNER_UID), {
          profileImageUrl: buildUrl(OWNER_UID, ext),
        }),
      );
    }
  });
});
