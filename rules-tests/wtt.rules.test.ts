import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { readFileSync } from "fs";
import { beforeAll, afterAll, afterEach, describe, it } from "vitest";

// Rules for What's That Trick (WTT). The intended model, mirrored from the
// comment block in firestore.rules:
//   wttItems  — server-written; signed-in users read only status=='open'
//   wttGold   — never client-readable or writable
//   wttVotes  — create-only, one per user per clip, email-verified, not own clip
//   users/{uid}/private/wtt — server-written, owner read
//   proReviews — Verified-Pro create only; no client reads

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-skatehubba-wtt-rules",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

const verified = (uid: string) => testEnv.authenticatedContext(uid, { email_verified: true });

async function seed(path: string, data: Record<string, unknown>) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data);
  });
}

const seedClip = (clipId: string, playerUid: string) =>
  seed(`clips/${clipId}`, { playerUid, trickName: "kickflip", createdAt: Timestamp.now() });

const vote = (clipId: string, uid: string, choice = "kickflip") => ({
  clipId,
  uid,
  choice,
  createdAt: serverTimestamp(),
});

const review = (uid: string, extra: Record<string, unknown> = {}) => ({
  clipId: "clip1",
  uid,
  answerTrickId: "kickflip",
  createdAt: serverTimestamp(),
  ...extra,
});

describe("wttItems", () => {
  it("lets a signed-in user read an open item", async () => {
    await seed("wttItems/open1", { clipId: "open1", status: "open", options: [] });
    await assertSucceeds(getDoc(doc(verified("alice").firestore(), "wttItems/open1")));
  });

  it("hides items that are not open", async () => {
    await seed("wttItems/closed1", { clipId: "closed1", status: "retired", options: [] });
    await assertFails(getDoc(doc(verified("alice").firestore(), "wttItems/closed1")));
  });

  it("rejects signed-out reads", async () => {
    await seed("wttItems/open1", { clipId: "open1", status: "open", options: [] });
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "wttItems/open1")));
  });

  it("rejects client creates and updates", async () => {
    const db = verified("alice").firestore();
    await assertFails(setDoc(doc(db, "wttItems/new1"), { clipId: "new1", status: "open" }));
    await seed("wttItems/open1", { clipId: "open1", status: "open" });
    await assertFails(updateDoc(doc(db, "wttItems/open1"), { status: "retired" }));
  });
});

describe("wttGold", () => {
  it("never lets a client read the gold answer", async () => {
    await seed("wttGold/clip1", { clipId: "clip1", trickId: "heelflip" });
    await assertFails(getDoc(doc(verified("alice").firestore(), "wttGold/clip1")));
  });

  it("never lets a client write the gold answer", async () => {
    await assertFails(setDoc(doc(verified("alice").firestore(), "wttGold/clip1"), { trickId: "kickflip" }));
  });
});

describe("wttVotes", () => {
  it("allows one vote with the clipId_uid doc id", async () => {
    await seedClip("clip1", "bob");
    await assertSucceeds(setDoc(doc(verified("alice").firestore(), "wttVotes/clip1_alice"), vote("clip1", "alice")));
  });

  it("rejects a wrong doc id", async () => {
    await seedClip("clip1", "bob");
    await assertFails(setDoc(doc(verified("alice").firestore(), "wttVotes/other"), vote("clip1", "alice")));
  });

  it("rejects voting as someone else", async () => {
    await seedClip("clip1", "carol");
    await assertFails(setDoc(doc(verified("alice").firestore(), "wttVotes/clip1_bob"), vote("clip1", "bob")));
  });

  it("rejects voting on your own clip", async () => {
    await seedClip("clip1", "alice");
    await assertFails(setDoc(doc(verified("alice").firestore(), "wttVotes/clip1_alice"), vote("clip1", "alice")));
  });

  it("rejects voting on a clip that does not exist", async () => {
    await assertFails(setDoc(doc(verified("alice").firestore(), "wttVotes/ghost_alice"), vote("ghost", "alice")));
  });

  it("rejects an unverified email", async () => {
    await seedClip("clip1", "bob");
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "wttVotes/clip1_alice"), vote("clip1", "alice")));
  });

  it("rejects banned users", async () => {
    await seedClip("clip1", "bob");
    await seed("bans/alice", { reason: "test" });
    await assertFails(setDoc(doc(verified("alice").firestore(), "wttVotes/clip1_alice"), vote("clip1", "alice")));
  });

  it("rejects empty, oversized or extra-field votes and client timestamps", async () => {
    await seedClip("clip1", "bob");
    const ref = doc(verified("alice").firestore(), "wttVotes/clip1_alice");
    await assertFails(setDoc(ref, vote("clip1", "alice", "")));
    await assertFails(setDoc(ref, vote("clip1", "alice", "x".repeat(49))));
    await assertFails(setDoc(ref, { ...vote("clip1", "alice"), weight: 10 }));
    await assertFails(setDoc(ref, { ...vote("clip1", "alice"), createdAt: Timestamp.now() }));
  });

  it("is create-only and readable only by its owner", async () => {
    await seed("wttVotes/clip1_alice", { clipId: "clip1", uid: "alice", choice: "kickflip" });
    const alice = verified("alice").firestore();
    await assertSucceeds(getDoc(doc(alice, "wttVotes/clip1_alice")));
    await assertFails(updateDoc(doc(alice, "wttVotes/clip1_alice"), { choice: "heelflip" }));
    await assertFails(deleteDoc(doc(alice, "wttVotes/clip1_alice")));
    await assertFails(getDoc(doc(verified("bob").firestore(), "wttVotes/clip1_alice")));
  });
});

describe("users/{uid}/private/wtt", () => {
  it("lets the owner read but nobody else", async () => {
    await seed("users/alice/private/wtt", { trickIq: 10 });
    await assertSucceeds(getDoc(doc(verified("alice").firestore(), "users/alice/private/wtt")));
    await assertFails(getDoc(doc(verified("bob").firestore(), "users/alice/private/wtt")));
  });

  it("rejects client writes, even by the owner", async () => {
    const db = verified("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice/private/wtt"), { trickIq: 999 }));
  });
});

describe("proReviews", () => {
  it("allows a Verified Pro to submit a review", async () => {
    await seed("users/pro", { username: "pro", isVerifiedPro: true });
    await assertSucceeds(setDoc(doc(verified("pro").firestore(), "proReviews/r1"), review("pro", { note: "clean" })));
  });

  it("rejects non-pros", async () => {
    await seed("users/bob", { username: "bob", isVerifiedPro: false });
    await assertFails(setDoc(doc(verified("bob").firestore(), "proReviews/r1"), review("bob")));
  });

  it("rejects a pro writing as someone else or with bad fields", async () => {
    await seed("users/pro", { username: "pro", isVerifiedPro: true });
    const db = verified("pro").firestore();
    await assertFails(setDoc(doc(db, "proReviews/r1"), review("other")));
    await assertFails(setDoc(doc(db, "proReviews/r2"), review("pro", { answerTrickId: "" })));
    await assertFails(setDoc(doc(db, "proReviews/r3"), review("pro", { note: "x".repeat(281) })));
    await assertFails(setDoc(doc(db, "proReviews/r4"), review("pro", { extra: true })));
  });

  it("is not client-readable", async () => {
    await seed("proReviews/r1", { clipId: "clip1", uid: "pro", answerTrickId: "kickflip" });
    await assertFails(getDoc(doc(verified("pro").firestore(), "proReviews/r1")));
  });
});
