/**
 * Spot chat messages: membership-gated create, 1 msg/sec anchor, the
 * server-side word filter, read rules, and soft delete permissions.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  collection,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";
import {
  ALICE,
  BOB,
  CREATOR,
  MOD,
  SPOT,
  db,
  makeMessage,
  memberRef,
  messageRef,
  seed,
  seedMember,
  seedMessage,
  seedSpot,
  sendBatch,
} from "./_spotChatFixtures";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-spot-chat-messages", async (env) => {
  await seed(env, async (fs) => {
    await seedSpot(fs);
    await seedMember(fs, ALICE);
    await seedMember(fs, BOB);
    await seedMember(fs, MOD, "moderator");
  });
});

describe("spotChats messages — create", () => {
  it("lets a member post a clean message with the anchor in the same batch", async () => {
    await assertSucceeds(sendBatch(db(getEnv(), ALICE), ALICE, "m1"));
  });

  it("denies a non-member", async () => {
    const fs = db(getEnv(), "strangerUid");
    const batch = writeBatch(fs);
    batch.set(messageRef(fs, "m1"), makeMessage("strangerUid"));
    await assertFails(batch.commit());
  });

  it("denies a message without the member anchor", async () => {
    const fs = db(getEnv(), ALICE);
    await assertFails(setDoc(messageRef(fs, "m1"), makeMessage(ALICE)));
  });

  it("denies a second message inside the 1s cooldown, then allows it once elapsed", async () => {
    await assertSucceeds(sendBatch(db(getEnv(), ALICE), ALICE, "m1"));
    await assertFails(sendBatch(db(getEnv(), ALICE), ALICE, "m2"));
    await seed(getEnv(), (fs) => updateDoc(memberRef(fs, ALICE), { lastMessageAt: new Date(Date.now() - 5000) }));
    await assertSucceeds(sendBatch(db(getEnv(), ALICE), ALICE, "m2"));
  });

  it("denies two messages riding one anchor bump", async () => {
    const fs = db(getEnv(), ALICE);
    const batch = writeBatch(fs);
    batch.set(messageRef(fs, "m1"), makeMessage(ALICE));
    batch.set(messageRef(fs, "m2"), makeMessage(ALICE));
    batch.update(memberRef(fs, ALICE), { lastMessageAt: serverTimestamp(), lastMessageId: "m1" });
    await assertFails(batch.commit());
  });

  it("denies an anchor that names a different message", async () => {
    await assertFails(sendBatch(db(getEnv(), ALICE), ALICE, "m1", {}, "other"));
  });

  it.each([
    ["spoofed author", { userId: BOB }],
    ["empty content", { content: "" }],
    ["oversized content", { content: "x".repeat(1001) }],
    ["client timestamp", { createdAt: new Date() }],
    ["pre-deleted", { isDeleted: true }],
    ["pre-moderated", { moderatedBy: MOD }],
    ["extra key", { pinned: true }],
    ["hidden without reason", { isHidden: true, hiddenReason: null }],
    ["reason without hiding", { isHidden: false, hiddenReason: "word_filter" }],
  ])("denies %s", async (_label, overrides) => {
    await assertFails(sendBatch(db(getEnv(), ALICE), ALICE, "m1", overrides));
  });

  it("denies an email-unverified sender", async () => {
    const fs = getEnv().authenticatedContext(ALICE, { email_verified: false }).firestore();
    await assertFails(sendBatch(fs, ALICE, "m1"));
  });

  it("denies a banned sender", async () => {
    await seed(getEnv(), (fs) => setDoc(doc(fs, "bans", ALICE), { reason: "test" }));
    await assertFails(sendBatch(db(getEnv(), ALICE), ALICE, "m1"));
  });

  it("denies a sender blocked from this chat", async () => {
    await seed(getEnv(), (fs) =>
      setDoc(doc(fs, "chatBlocks", `${SPOT}_${ALICE}`), { spotId: SPOT, blockedUid: ALICE, blockedBy: MOD }),
    );
    await assertFails(sendBatch(db(getEnv(), ALICE), ALICE, "m1"));
  });
});

describe("spotChats messages — word filter", () => {
  it.each(["you are a retard", "KYS", "fags lol", "line one\nkys", "retarded take"])(
    "denies %j posted visible",
    async (content) => {
      await assertFails(sendBatch(db(getEnv(), ALICE), ALICE, "m1", { content }));
    },
  );

  it("allows the same content posted pre-hidden by the client filter", async () => {
    await assertSucceeds(
      sendBatch(db(getEnv(), ALICE), ALICE, "m1", { content: "kys", isHidden: true, hiddenReason: "word_filter" }),
    );
  });

  it.each(["spices on the grill", "Niger river trip", "spicy ledge", "the Scunthorpe skatepark"])(
    "does not flag %j",
    async (content) => {
      await assertSucceeds(sendBatch(db(getEnv(), ALICE), ALICE, "m1", { content }));
    },
  );
});

describe("spotChats messages — read", () => {
  it("lets any signed-in user list messages", async () => {
    await seed(getEnv(), (fs) => seedMessage(fs, "m1", BOB));
    await assertSucceeds(getDocs(collection(db(getEnv(), "outsiderUid"), "spotChats", SPOT, "messages")));
  });

  it("denies a signed-out reader", async () => {
    await seed(getEnv(), (fs) => seedMessage(fs, "m1", BOB));
    await assertFails(getDoc(messageRef(getEnv().unauthenticatedContext().firestore(), "m1")));
  });

  it("hides a single message from a reader who blocked its sender", async () => {
    await seed(getEnv(), async (fs) => {
      await seedMessage(fs, "m1", BOB);
      await setDoc(doc(fs, "users", ALICE, "blocked_users", BOB), { blockedUid: BOB });
    });
    await assertFails(getDoc(messageRef(db(getEnv(), ALICE), "m1")));
    await assertSucceeds(getDoc(messageRef(db(getEnv(), MOD), "m1")));
  });
});

describe("spotChats messages — delete", () => {
  it("lets the author soft-delete their own message", async () => {
    await seed(getEnv(), (fs) => seedMessage(fs, "m1", ALICE));
    await assertSucceeds(updateDoc(messageRef(db(getEnv(), ALICE), "m1"), { isDeleted: true, content: "" }));
  });

  it("denies the author keeping content or stamping moderatedBy", async () => {
    await seed(getEnv(), (fs) => seedMessage(fs, "m1", ALICE));
    const ref = messageRef(db(getEnv(), ALICE), "m1");
    await assertFails(updateDoc(ref, { isDeleted: true }));
    await assertFails(updateDoc(ref, { isDeleted: true, content: "", moderatedBy: ALICE }));
    await assertFails(updateDoc(ref, { content: "edited" }));
  });

  it("denies a regular member deleting someone else's message", async () => {
    await seed(getEnv(), (fs) => seedMessage(fs, "m1", ALICE));
    await assertFails(updateDoc(messageRef(db(getEnv(), BOB), "m1"), { isDeleted: true, content: "" }));
  });

  it("lets a moderator remove any message, stamped with their uid", async () => {
    await seed(getEnv(), (fs) => seedMessage(fs, "m1", ALICE));
    const ref = messageRef(db(getEnv(), MOD), "m1");
    await assertFails(updateDoc(ref, { isDeleted: true, content: "", moderatedBy: BOB }));
    await assertSucceeds(updateDoc(ref, { isDeleted: true, content: "", moderatedBy: MOD }));
  });

  it("lets the spot creator remove a message without holding a member doc", async () => {
    await seed(getEnv(), (fs) => seedMessage(fs, "m1", ALICE));
    await assertSucceeds(
      updateDoc(messageRef(db(getEnv(), CREATOR), "m1"), { isDeleted: true, content: "", moderatedBy: CREATOR }),
    );
  });

  it("denies re-deleting and hard deletes", async () => {
    await seed(getEnv(), async (fs) => {
      await seedMessage(fs, "m1", ALICE);
      await updateDoc(messageRef(fs, "m1"), { isDeleted: true, content: "" });
    });
    await assertFails(
      updateDoc(messageRef(db(getEnv(), MOD), "m1"), { isDeleted: true, content: "", moderatedBy: MOD }),
    );
    await assertFails(deleteDoc(messageRef(db(getEnv(), ALICE), "m1")));
  });
});
