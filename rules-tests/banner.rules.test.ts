/**
 * Profile banner rules (VITE_FEATURE_PROFILE_BANNER):
 *  - Storage: users/{uid}/banner.webp is owner-only create/delete, webp only,
 *    1 KB–2 MB, no update, any signed-in read.
 *  - Firestore: users/{uid}.bannerImageUrl is pinned to the project bucket +
 *    the writer's uid (same anti-phishing guard as profileImageUrl).
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { seedUsernameReservation, setupRulesTestEnv, setupStorageRulesTestEnv } from "./_fixtures";

const PROD_BUCKET = "sk8hub-d7806.firebasestorage.app";
const OWNER = "owner-uid";
const OTHER = "other-uid";
const NEW_OWNER = "new-owner-uid";

function url(uid: string, file = "banner.webp", bucket = PROD_BUCKET): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/users%2F${uid}%2F${file}?alt=media&token=abc`;
}

describe("banner Firestore rule — bannerImageUrl pinning", () => {
  const getEnv = setupRulesTestEnv("demo-skatehubba-rules-banner-firestore", async (env) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OWNER), {
        uid: OWNER,
        username: "owner",
        stance: "Regular",
        createdAt: serverTimestamp(),
      });
    });
  });
  const ownerDoc = () =>
    doc(getEnv().authenticatedContext(OWNER, { email_verified: true }).firestore(), "users", OWNER);

  it("allows the owner's own banner URL and null", async () => {
    await assertSucceeds(updateDoc(ownerDoc(), { bannerImageUrl: url(OWNER) }));
    await assertSucceeds(updateDoc(ownerDoc(), { bannerImageUrl: null }));
  });

  it("denies another uid, another bucket, an external URL, a non-banner file, or a non-string", async () => {
    await assertFails(updateDoc(ownerDoc(), { bannerImageUrl: url(OTHER) }));
    await assertFails(updateDoc(ownerDoc(), { bannerImageUrl: url(OWNER, "banner.webp", "evil.firebasestorage.app") }));
    await assertFails(updateDoc(ownerDoc(), { bannerImageUrl: "https://evil.example.com/banner.webp" }));
    await assertFails(updateDoc(ownerDoc(), { bannerImageUrl: url(OWNER, "banner.png") }));
    await assertFails(updateDoc(ownerDoc(), { bannerImageUrl: 42 }));
  });

  it("pins the URL on create too", async () => {
    await seedUsernameReservation(getEnv(), NEW_OWNER, "new_owner");
    const newDoc = () =>
      doc(getEnv().authenticatedContext(NEW_OWNER, { email_verified: true }).firestore(), "users", NEW_OWNER);
    const base = { uid: NEW_OWNER, username: "new_owner", stance: "Regular", createdAt: serverTimestamp() };
    await assertFails(setDoc(newDoc(), { ...base, bannerImageUrl: "https://evil.example.com/b.webp" }));
    await assertSucceeds(setDoc(newDoc(), { ...base, bannerImageUrl: url(NEW_OWNER) }));
  });
});

describe("banner Storage rule — users/{uid}/banner.webp", () => {
  const getEnv = setupStorageRulesTestEnv("demo-skatehubba-rules-banner-storage");
  const owner = () => getEnv().authenticatedContext(OWNER, { email_verified: true }).storage();
  const other = () => getEnv().authenticatedContext(OTHER, { email_verified: true }).storage();
  const path = `users/${OWNER}/banner.webp`;
  const bytes = (n: number) => new Uint8Array(n).fill(0x42);

  it("owner can upload a webp banner; anyone signed in can read it", async () => {
    await assertSucceeds(owner().ref(path).put(bytes(4096), { contentType: "image/webp" }));
    await assertSucceeds(other().ref(path).getMetadata());
    await assertFails(getEnv().unauthenticatedContext().storage().ref(path).getMetadata());
  });

  it("denies a stranger, wrong type, wrong name, too small and too large", async () => {
    await assertFails(other().ref(path).put(bytes(4096), { contentType: "image/webp" }));
    await assertFails(owner().ref(path).put(bytes(4096), { contentType: "image/png" }));
    await assertFails(owner().ref(`users/${OWNER}/banner.png`).put(bytes(4096), { contentType: "image/png" }));
    await assertFails(owner().ref(path).put(bytes(512), { contentType: "image/webp" }));
    await assertFails(
      owner()
        .ref(path)
        .put(bytes(3 * 1024 * 1024), { contentType: "image/webp" }),
    );
  });

  it("denies overwrite; only the owner can delete", async () => {
    await assertSucceeds(owner().ref(path).put(bytes(4096), { contentType: "image/webp" }));
    // updateMetadata routes to the UPDATE rule, which is `if false`.
    await assertFails(owner().ref(path).updateMetadata({ contentType: "image/png" }));
    await assertFails(other().ref(path).delete());
    await assertSucceeds(owner().ref(path).delete());
  });
});
