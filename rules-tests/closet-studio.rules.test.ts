/**
 * Closet Studio rules (VITE_FEATURE_CLOSET_STUDIO):
 *  - Firestore users/{uid}/closetDesigns/d0..d23: owner-only writes, fixed
 *    keys, URL pinning, Mike White credit enforced, shared requires moderation.
 *  - Storage closetDesigns/{uid}/d0..d23.webp: owner-only, webp, 100 B–1 MB.
 */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { setupRulesTestEnv, setupStorageRulesTestEnv } from "./_fixtures";

const BUCKET = "sk8hub-d7806.firebasestorage.app";
const OWNER = "owner-uid";
const OTHER = "other-uid";
const url = (uid = OWNER, id = "d0") =>
  `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/closetDesigns%2F${uid}%2F${id}.webp?alt=media&token=t`;

function valid(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Fire Teeth",
    slot: "shoes",
    templateId: "mike_white_teeth_fire",
    credit: "Based on a Mike White design",
    imageUrl: url(),
    layerCount: 3,
    shared: false,
    moderation: "pending",
    updatedAt: serverTimestamp(),
    ...over,
  };
}

describe("closetDesigns Firestore rules", () => {
  const getEnv = setupRulesTestEnv("demo-skatehubba-rules-closet-studio");
  const db = (as: string | null) =>
    as
      ? getEnv().authenticatedContext(as, { email_verified: true }).firestore()
      : getEnv().unauthenticatedContext().firestore();
  const ref = (as: string | null, id = "d0", uid = OWNER) => doc(db(as), "users", uid, "closetDesigns", id);

  it("lets the owner save, list and delete; original work has no credit", async () => {
    await assertSucceeds(setDoc(ref(OWNER), valid()));
    await assertSucceeds(
      setDoc(ref(OWNER, "d23"), valid({ templateId: "", credit: "", imageUrl: url(OWNER, "d23"), slot: "top" })),
    );
    await assertSucceeds(getDocs(collection(db(OWNER), "users", OWNER, "closetDesigns")));
    await assertSucceeds(deleteDoc(ref(OWNER, "d23")));
  });

  it("requires the Mike White credit on his templates and forbids it elsewhere", async () => {
    await assertFails(setDoc(ref(OWNER), valid({ credit: "" })));
    await assertFails(setDoc(ref(OWNER), valid({ credit: "Designed by me" })));
    await assertFails(setDoc(ref(OWNER), valid({ templateId: "", credit: "Based on a Mike White design" })));
  });

  it("only shares moderated designs; shared designs are readable by others", async () => {
    await assertFails(setDoc(ref(OWNER), valid({ shared: true, moderation: "pending" })));
    await assertSucceeds(setDoc(ref(OWNER), valid()));
    await assertSucceeds(getDoc(ref(OWNER)));
    await assertFails(getDoc(ref(OTHER)));
    await assertSucceeds(setDoc(ref(OWNER), valid({ shared: true, moderation: "passed" })));
    await assertSucceeds(getDoc(ref(OTHER)));
    await assertFails(getDocs(collection(db(OTHER), "users", OWNER, "closetDesigns")));
  });

  it("denies strangers, bad ids, foreign URLs, extra keys and out-of-range values", async () => {
    await assertFails(setDoc(ref(OTHER), valid()));
    await assertFails(setDoc(ref(null), valid()));
    await assertFails(setDoc(ref(OWNER, "d24"), valid({ imageUrl: url(OWNER, "d24") })));
    await assertFails(setDoc(ref(OWNER, "x"), valid()));
    await assertFails(setDoc(ref(OWNER), valid({ imageUrl: url(OTHER) })));
    await assertFails(setDoc(ref(OWNER), valid({ imageUrl: url(OWNER, "d1") })));
    await assertFails(setDoc(ref(OWNER), valid({ imageUrl: "https://evil.example.com/a.webp" })));
    await assertFails(setDoc(ref(OWNER), valid({ extra: 1 })));
    await assertFails(setDoc(ref(OWNER), valid({ name: "" })));
    await assertFails(setDoc(ref(OWNER), valid({ name: "x".repeat(41) })));
    await assertFails(setDoc(ref(OWNER), valid({ slot: "cape" })));
    await assertFails(setDoc(ref(OWNER), valid({ layerCount: 9 })));
    await assertFails(setDoc(ref(OWNER), valid({ moderation: "maybe" })));
    await assertFails(setDoc(ref(OWNER), valid({ updatedAt: new Date(0) })));
    await assertFails(deleteDoc(ref(OTHER)));
  });
});

describe("closetDesigns Storage rules", () => {
  const getEnv = setupStorageRulesTestEnv("demo-skatehubba-rules-closet-studio-storage");
  const st = (uid: string) => getEnv().authenticatedContext(uid, { email_verified: true }).storage();
  const path = `closetDesigns/${OWNER}/d0.webp`;
  const bytes = (n: number) => new Uint8Array(n).fill(0x42);
  const meta = (uid = OWNER, contentType = "image/webp") => ({ contentType, customMetadata: { uploaderUid: uid } });

  it("owner can upload, read and delete; nobody else can", async () => {
    await assertSucceeds(st(OWNER).ref(path).put(bytes(4096), meta()));
    await assertSucceeds(st(OWNER).ref(path).getMetadata());
    await assertFails(st(OTHER).ref(path).getMetadata());
    await assertFails(st(OTHER).ref(path).delete());
    await assertFails(st(OWNER).ref(path).updateMetadata({ contentType: "image/png" }));
    await assertSucceeds(st(OWNER).ref(path).delete());
  });

  it("denies strangers, wrong type/name/metadata and bad sizes", async () => {
    await assertFails(st(OTHER).ref(path).put(bytes(4096), meta(OTHER)));
    await assertFails(st(OWNER).ref(path).put(bytes(4096), meta(OWNER, "image/png")));
    await assertFails(st(OWNER).ref(path).put(bytes(4096), meta(OTHER)));
    await assertFails(st(OWNER).ref(`closetDesigns/${OWNER}/d24.webp`).put(bytes(4096), meta()));
    await assertFails(st(OWNER).ref(path).put(bytes(50), meta()));
    await assertFails(
      st(OWNER)
        .ref(path)
        .put(bytes(1024 * 1024 + 1), meta()),
    );
  });
});
