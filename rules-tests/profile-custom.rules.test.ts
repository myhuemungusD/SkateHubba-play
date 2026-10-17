/**
 * Customizable profile rules (VITE_FEATURE_PROFILE_CUSTOM):
 * users/{uid}/profileCustom/main — public get, owner-only write, fixed keys,
 * size/length caps and a host allowlist on links.
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const OWNER = "owner-uid";
const OTHER = "other-uid";

function valid(): Record<string, unknown> {
  return {
    accent: "#FF6B00",
    gradientFrom: "#112233",
    gradientTo: "#000000",
    gradientAngle: 135,
    bannerPosX: 50,
    bannerPosY: 30,
    bannerZoom: 120,
    sections: ["stats", "clips", "closet", "crew", "spots"],
    pinnedClipIds: ["c1", "c2"],
    showcaseSignature: true,
    bio: "Skate every day",
    links: [
      { label: "IG", url: "https://www.instagram.com/mike" },
      { label: "Shop", url: "https://mikewhite.myshopify.com/products/m1" },
    ],
    sponsors: [{ name: "B-One", url: "" }],
    favoriteTricks: ["Kickflip", "Crooked grind"],
    themeSongId: "lofi-75",
    updatedAt: serverTimestamp(),
  };
}

describe("profileCustom rules", () => {
  const getEnv = setupRulesTestEnv("demo-skatehubba-rules-profile-custom");
  const ref = (as: string | null, uid = OWNER, id = "main") => {
    const ctx = as ? getEnv().authenticatedContext(as, { email_verified: true }) : getEnv().unauthenticatedContext();
    return doc(ctx.firestore(), "users", uid, "profileCustom", id);
  };

  it("lets the owner create, update and delete a valid doc", async () => {
    await assertSucceeds(setDoc(ref(OWNER), valid()));
    await assertSucceeds(setDoc(ref(OWNER), { ...valid(), bio: "", links: [], sponsors: [], pinnedClipIds: [] }));
    await assertSucceeds(deleteDoc(ref(OWNER)));
  });

  it("is publicly readable by get but not listable", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OWNER, "profileCustom", "main"), { bio: "x" });
    });
    await assertSucceeds(getDoc(ref(null)));
    await assertSucceeds(getDoc(ref(OTHER)));
    const ctx = getEnv().authenticatedContext(OTHER).firestore();
    await assertFails(getDocs(collection(ctx, "users", OWNER, "profileCustom")));
  });

  it("denies non-owners, signed-out writers and other doc ids", async () => {
    await assertFails(setDoc(ref(OTHER), valid()));
    await assertFails(setDoc(ref(null), valid()));
    await assertFails(setDoc(ref(OWNER, OWNER, "other"), valid()));
    await assertFails(deleteDoc(ref(OTHER)));
  });

  it("denies unknown or missing keys and a client timestamp", async () => {
    await assertFails(setDoc(ref(OWNER), { ...valid(), isVerifiedPro: true }));
    const missing = valid();
    delete missing.bio;
    await assertFails(setDoc(ref(OWNER), missing));
    await assertFails(setDoc(ref(OWNER), { ...valid(), updatedAt: new Date(0) }));
  });

  it("enforces colors, numeric ranges and section order", async () => {
    await assertFails(setDoc(ref(OWNER), { ...valid(), accent: "red" }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), gradientTo: "#12345" }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), gradientAngle: 360 }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), bannerPosY: 101 }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), bannerZoom: 99 }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), bannerPosX: 1.5 }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), sections: ["clips", "stats", "closet", "crew"] }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), sections: ["clips", "clips", "stats", "closet", "crew"] }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), showcaseSignature: "yes" }));
  });

  it("caps lengths and list sizes", async () => {
    await assertFails(setDoc(ref(OWNER), { ...valid(), bio: "x".repeat(281) }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), pinnedClipIds: ["a", "b", "c", "d"] }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), pinnedClipIds: [""] }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), favoriteTricks: ["a", "b", "c", "d", "e", "f"] }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), favoriteTricks: ["x".repeat(41)] }));
    const six = Array.from({ length: 6 }, () => ({ label: "IG", url: "https://instagram.com/a" }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), links: six }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), links: [{ label: "x".repeat(31), url: "https://x.com/a" }] }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), sponsors: [{ name: "", url: "" }] }));
  });

  it("only allows links on allowlisted https hosts", async () => {
    const link = (url: string) => setDoc(ref(OWNER), { ...valid(), links: [{ label: "L", url }] });
    await assertSucceeds(link("https://youtu.be/abc"));
    await assertSucceeds(link("https://open.spotify.com/track/1"));
    await assertFails(link("http://instagram.com/a"));
    await assertFails(link("https://evil.com/instagram.com"));
    await assertFails(link("https://instagram.com.evil.com/a"));
    await assertFails(link("javascript:alert(1)"));
    await assertFails(link("https://instagram.com/" + "a".repeat(200)));
    await assertFails(link("https://instagram.com/a b"));
    await assertFails(setDoc(ref(OWNER), { ...valid(), sponsors: [{ name: "S", url: "https://phish.example.com" }] }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), links: [{ label: "L", url: "https://x.com", extra: 1 }] }));
  });

  it("only allows library theme songs", async () => {
    await assertSucceeds(setDoc(ref(OWNER), { ...valid(), themeSongId: "" }));
    await assertFails(setDoc(ref(OWNER), { ...valid(), themeSongId: "https://evil.example.com/a.mp3" }));
  });
});
