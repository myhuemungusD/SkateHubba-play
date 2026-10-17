import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, updateDoc, serverTimestamp, Timestamp } from "firebase/firestore";
import { readFileSync } from "fs";
import { beforeAll, afterAll, afterEach, describe, it, expect } from "vitest";

const PROJECT_ID = "demo-skatehubba-wtt-rules";

let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

// ── Test helpers ──

async function seedWttItem(itemId: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const itemRef = doc(ctx.firestore(), "wttItems", itemId);
    await setDoc(itemRef, {
      clipId: itemId,
      correctTrickId: "kickflip",
      options: ["kickflip", "heelflip", "impossible", "bigflip"],
      voteCount: 0,
      consensus: null,
      retired: false,
      createdAt: Timestamp.now(),
    });
  });
}

async function seedWttGold(clipId: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const goldRef = doc(ctx.firestore(), "wttGold", clipId);
    await setDoc(goldRef, {
      clipId,
      trickId: "heelflip",
      verifiedBy: "pro-uid-123",
      createdAt: Timestamp.now(),
    });
  });
}

async function seedWttVote(voteId: string, uid: string, clipId: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const voteRef = doc(ctx.firestore(), "wttVotes", voteId);
    await setDoc(voteRef, {
      clipId,
      uid,
      choice: "kickflip",
      createdAt: Timestamp.now(),
    });
  });
}

async function seedWttReliability(uid: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const wttRef = doc(ctx.firestore(), "users", uid, "private", "wtt");
    await setDoc(wttRef, {
      reliabilityScore: 0.85,
      votesSubmitted: 10,
      goldCorrect: 8,
      updatedAt: Timestamp.now(),
    });
  });
}

async function seedVerifiedPro(uid: string, username: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const userRef = doc(ctx.firestore(), "users", uid);
    await setDoc(userRef, {
      username,
      isVerifiedPro: true,
      createdAt: Timestamp.now(),
    });
  });
}

async function seedRegularUser(uid: string, username: string) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const userRef = doc(ctx.firestore(), "users", uid);
    await setDoc(userRef, {
      username,
      isVerifiedPro: false,
      createdAt: Timestamp.now(),
    });
  });
}

function createVote(clipId: string, uid: string, choice: string) {
  return {
    clipId,
    uid,
    choice,
    createdAt: serverTimestamp(),
  };
}

describe("wttItems collection (server-written)", () => {
  it("rejects any client create attempt", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const itemRef = doc(alice.firestore(), "wttItems", "clip123");
    await assertFails(
      setDoc(itemRef, {
        clipId: "clip123",
        correctTrickId: "kickflip",
        options: ["kickflip", "heelflip", "impossible", "bigflip"],
        voteCount: 0,
        consensus: null,
        retired: false,
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("rejects any client update attempt", async () => {
    await seedWttItem("clip123");

    const alice = testEnv.authenticatedContext("alice");
    const itemRef = doc(alice.firestore(), "wttItems", "clip123");
    await assertFails(updateDoc(itemRef, { voteCount: 5 }));
  });

  it("allows authenticated reads", async () => {
    await seedWttItem("clip123");

    const alice = testEnv.authenticatedContext("alice");
    const itemRef = doc(alice.firestore(), "wttItems", "clip123");
    await assertSucceeds(itemRef.get());
  });

  it("rejects unauthenticated reads", async () => {
    await seedWttItem("clip123");

    const unauthed = testEnv.unauthenticatedContext();
    const itemRef = doc(unauthed.firestore(), "wttItems", "clip123");
    await assertFails(itemRef.get());
  });
});

describe("wttGold collection (server-written)", () => {
  it("rejects any client create attempt", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const goldRef = doc(alice.firestore(), "wttGold", "clip456");
    await assertFails(
      setDoc(goldRef, {
        clipId: "clip456",
        trickId: "heelflip",
        verifiedBy: "pro-uid-123",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("rejects any client update attempt", async () => {
    await seedWttGold("clip456");

    const alice = testEnv.authenticatedContext("alice");
    const goldRef = doc(alice.firestore(), "wttGold", "clip456");
    await assertFails(updateDoc(goldRef, { trickId: "kickflip" }));
  });

  it("allows authenticated reads", async () => {
    await seedWttGold("clip456");

    const alice = testEnv.authenticatedContext("alice");
    const goldRef = doc(alice.firestore(), "wttGold", "clip456");
    await assertSucceeds(goldRef.get());
  });
});

describe("wttVotes collection (create-only, strict doc ID)", () => {
  it("allows a user to vote once per clip with correct doc ID", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const voteRef = doc(alice.firestore(), "wttVotes", "clip123_alice");
    await assertSucceeds(setDoc(voteRef, createVote("clip123", "alice", "kickflip")));
  });

  it("rejects vote with wrong doc ID format", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const voteRef = doc(alice.firestore(), "wttVotes", "wrongFormat");
    await assertFails(setDoc(voteRef, createVote("clip123", "alice", "kickflip")));
  });

  it("rejects vote where uid doesn't match auth", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const voteRef = doc(alice.firestore(), "wttVotes", "clip123_bob");
    await assertFails(setDoc(voteRef, createVote("clip123", "bob", "kickflip")));
  });

  it("rejects vote where doc ID uid doesn't match data uid", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const voteRef = doc(alice.firestore(), "wttVotes", "clip123_alice");
    await assertFails(setDoc(voteRef, createVote("clip123", "bob", "kickflip")));
  });

  it("rejects vote on clip owned by voter", async () => {
    // First create a clip owned by alice
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const clipRef = doc(ctx.firestore(), "clips", "clip123");
      await setDoc(clipRef, {
        playerUid: "alice",
        trickName: "kickflip",
        createdAt: Timestamp.now(),
      });
    });

    const alice = testEnv.authenticatedContext("alice");
    const voteRef = doc(alice.firestore(), "wttVotes", "clip123_alice");
    await assertFails(setDoc(voteRef, createVote("clip123", "alice", "kickflip")));
  });

  it("rejects vote with missing required fields", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const voteRef = doc(alice.firestore(), "wttVotes", "clip123_alice");
    await assertFails(
      setDoc(voteRef, {
        clipId: "clip123",
        uid: "alice",
        // missing choice
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("rejects vote with invalid choice value", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const voteRef = doc(alice.firestore(), "wttVotes", "clip123_alice");
    await assertFails(setDoc(voteRef, createVote("clip123", "alice", "")));
  });

  it("rejects any update attempt (create-only)", async () => {
    await seedWttVote("clip123_alice", "alice", "clip123");

    const alice = testEnv.authenticatedContext("alice");
    const voteRef = doc(alice.firestore(), "wttVotes", "clip123_alice");
    await assertFails(updateDoc(voteRef, { choice: "heelflip" }));
  });

  it("allows authenticated reads of own votes", async () => {
    await seedWttVote("clip123_alice", "alice", "clip123");

    const alice = testEnv.authenticatedContext("alice");
    const voteRef = doc(alice.firestore(), "wttVotes", "clip123_alice");
    await assertSucceeds(voteRef.get());
  });
});

describe("users/{uid}/private/wtt (server-written reliability scores)", () => {
  it("rejects any client create attempt", async () => {
    const alice = testEnv.authenticatedContext("alice");
    const wttRef = doc(alice.firestore(), "users", "alice", "private", "wtt");
    await assertFails(
      setDoc(wttRef, {
        reliabilityScore: 0.85,
        votesSubmitted: 10,
        goldCorrect: 8,
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("rejects any client update attempt", async () => {
    await seedWttReliability("alice");

    const alice = testEnv.authenticatedContext("alice");
    const wttRef = doc(alice.firestore(), "users", "alice", "private", "wtt");
    await assertFails(updateDoc(wttRef, { reliabilityScore: 0.99 }));
  });

  it("allows user to read own reliability doc", async () => {
    await seedWttReliability("alice");

    const alice = testEnv.authenticatedContext("alice");
    const wttRef = doc(alice.firestore(), "users", "alice", "private", "wtt");
    await assertSucceeds(wttRef.get());
  });

  it("rejects other users reading someone else's reliability", async () => {
    await seedWttReliability("alice");

    const bob = testEnv.authenticatedContext("bob");
    const wttRef = doc(bob.firestore(), "users", "alice", "private", "wtt");
    await assertFails(wttRef.get());
  });
});

describe("proReviews collection (pros only)", () => {
  it("allows a verified pro to submit a review", async () => {
    await seedVerifiedPro("alice", "alice");

    const alice = testEnv.authenticatedContext("alice");
    const reviewRef = doc(alice.firestore(), "proReviews", "review123");
    await assertSucceeds(
      setDoc(reviewRef, {
        clipId: "clip123",
        reviewerUid: "alice",
        answerTrickId: "kickflip",
        note: "Clean kickflip",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("rejects non-pro review submission", async () => {
    await seedRegularUser("bob", "bob");

    const bob = testEnv.authenticatedContext("bob");
    const reviewRef = doc(bob.firestore(), "proReviews", "review123");
    await assertFails(
      setDoc(reviewRef, {
        clipId: "clip123",
        reviewerUid: "bob",
        answerTrickId: "kickflip",
        note: "Clean kickflip",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("rejects review where reviewerUid doesn't match auth", async () => {
    await seedVerifiedPro("alice", "alice");

    const alice = testEnv.authenticatedContext("alice");
    const reviewRef = doc(alice.firestore(), "proReviews", "review123");
    await assertFails(
      setDoc(reviewRef, {
        clipId: "clip123",
        reviewerUid: "someone-else",
        answerTrickId: "kickflip",
        note: "Clean kickflip",
        createdAt: serverTimestamp(),
      }),
    );
  });

  it("allows authenticated reads", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const reviewRef = doc(ctx.firestore(), "proReviews", "review123");
      await setDoc(reviewRef, {
        clipId: "clip123",
        reviewerUid: "pro-alice",
        answerTrickId: "kickflip",
        note: "Clean kickflip",
        createdAt: Timestamp.now(),
      });
    });

    const bob = testEnv.authenticatedContext("bob");
    const reviewRef = doc(bob.firestore(), "proReviews", "review123");
    await assertSucceeds(reviewRef.get());
  });
});
