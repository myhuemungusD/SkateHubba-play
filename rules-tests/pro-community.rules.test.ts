/** Pro challenges / props / featured: verified-pro creates, players enter with own clips; admins get no pro write. */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-pro-community", async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "users", "pro"), { isVerifiedPro: true, username: "pro" });
    await setDoc(doc(db, "users", "kid"), { isVerifiedPro: false, username: "kid" });
    await setDoc(doc(db, "clips", "kidclip"), { playerUid: "kid" });
    await setDoc(doc(db, "clips", "proclip"), { playerUid: "pro" });
    await setDoc(doc(db, "proChallenges", "c1"), { proUid: "pro", trickName: "kf" });
  });
});

const as = (uid: string, claims: Record<string, unknown> = {}) =>
  getEnv()
    .authenticatedContext(uid, { email_verified: true, ...claims })
    .firestore();
const admin = () => as("admin", { admin: true });
const challenge = (uid: string) => ({
  proUid: uid,
  proUsername: uid,
  trickName: "tre",
  description: "",
  createdAt: serverTimestamp(),
});
const entry = (uid: string, clipId: string) => ({
  challengeId: "c1",
  uid,
  username: uid,
  clipId,
  featured: false,
  createdAt: serverTimestamp(),
});
const prop = (from: string, to: string, sticker = "fire") => ({
  fromUid: from,
  fromUsername: from,
  toUid: to,
  toUsername: to,
  sticker,
  note: "",
  createdAt: serverTimestamp(),
});
const feat = (uid: string, clipId: string) => ({ clipId, proUid: uid, proUsername: uid, createdAt: serverTimestamp() });

describe("proChallenges", () => {
  it("only verified pros post; owner deletes", async () => {
    await assertSucceeds(setDoc(doc(as("pro"), "proChallenges", "n1"), challenge("pro")));
    await assertFails(setDoc(doc(as("kid"), "proChallenges", "n2"), challenge("kid")));
    await assertFails(setDoc(doc(admin(), "proChallenges", "n3"), challenge("admin")));
    await assertFails(setDoc(doc(as("pro"), "proChallenges", "n4"), challenge("kid")));
    await assertSucceeds(getDoc(doc(as("kid"), "proChallenges", "c1")));
    await assertFails(deleteDoc(doc(as("kid"), "proChallenges", "c1")));
  });
});

describe("proChallengeEntries", () => {
  it("a player enters once with their own clip; only the challenge's pro features", async () => {
    await assertFails(setDoc(doc(as("kid"), "proChallengeEntries", "c1_kid"), entry("kid", "proclip")));
    await assertFails(setDoc(doc(as("kid"), "proChallengeEntries", "x_kid"), entry("kid", "kidclip")));
    await assertFails(
      setDoc(doc(as("kid"), "proChallengeEntries", "c1_kid"), { ...entry("kid", "kidclip"), featured: true }),
    );
    await assertSucceeds(setDoc(doc(as("kid"), "proChallengeEntries", "c1_kid"), entry("kid", "kidclip")));
    await assertFails(updateDoc(doc(as("kid"), "proChallengeEntries", "c1_kid"), { featured: true }));
    await assertFails(updateDoc(doc(admin(), "proChallengeEntries", "c1_kid"), { featured: true }));
    await assertFails(updateDoc(doc(as("pro"), "proChallengeEntries", "c1_kid"), { featured: true, clipId: "x" }));
    await assertSucceeds(updateDoc(doc(as("pro"), "proChallengeEntries", "c1_kid"), { featured: true }));
  });
});

describe("proProps", () => {
  it("pros give props to others with a known sticker", async () => {
    await assertSucceeds(setDoc(doc(as("pro"), "proProps", "p1"), prop("pro", "kid")));
    await assertFails(setDoc(doc(as("pro"), "proProps", "p2"), prop("pro", "pro")));
    await assertFails(setDoc(doc(as("pro"), "proProps", "p3"), prop("pro", "kid", "badge")));
    await assertFails(setDoc(doc(as("pro"), "proProps", "p4"), prop("pro", "ghost")));
    await assertFails(setDoc(doc(as("kid"), "proProps", "p5"), prop("kid", "pro")));
    await assertFails(setDoc(doc(admin(), "proProps", "p6"), prop("admin", "kid")));
  });
});

describe("proFeatured", () => {
  it("pros pin existing clips under their own name and unpin their own", async () => {
    await assertSucceeds(setDoc(doc(as("pro"), "proFeatured", "kidclip"), feat("pro", "kidclip")));
    await assertFails(setDoc(doc(as("pro"), "proFeatured", "nope"), feat("pro", "nope")));
    await assertFails(setDoc(doc(as("kid"), "proFeatured", "proclip"), feat("kid", "proclip")));
    await assertFails(setDoc(doc(admin(), "proFeatured", "proclip"), feat("admin", "proclip")));
    await assertFails(deleteDoc(doc(as("kid"), "proFeatured", "kidclip")));
    await assertSucceeds(deleteDoc(doc(as("pro"), "proFeatured", "kidclip")));
  });
});
