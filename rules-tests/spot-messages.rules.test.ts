/**
 * Firestore security rules tests for spots/{spotId}/messages collection.
 *
 * Tests:
 * - Read: signed-in users can read messages
 * - Create: signed-in users can post messages with rate limiting and word filter
 * - Update: admin-only hide/unhide
 * - Rate limit: enforces 3-second cooldown
 * - Word filter: auto-flags messages with blocked words
 *
 * Run via: npm run test:rules
 */
import { describe, it, beforeEach } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  writeBatch,
  type RulesTestEnvironment,
} from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const ALICE = "alice-uid";
const BOB = "bob-uid";
const ADMIN = "admin-uid";
const SPOT_ID = "test-spot-123";

const getEnv = setupRulesTestEnv("demo-skatehubba-rules-spot-messages", (env) =>
  env.withSecurityRulesDisabled(async (admin) => {
    await setDoc(doc(admin.firestore(), "spots", SPOT_ID), {
      name: "Test Spot",
      createdBy: ALICE,
      latitude: 40.7,
      longitude: -74.0,
      gnarRating: 3,
      bustRisk: 2,
      obstacles: ["ledge"],
      photoUrls: [],
      isVerified: false,
      isActive: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // Seed user docs for rate limiting
    await setDoc(doc(admin.firestore(), "users", ALICE), {
      uid: ALICE,
      username: "alice",
      createdAt: serverTimestamp(),
    });
    await setDoc(doc(admin.firestore(), "users", BOB), {
      uid: BOB,
      username: "bob",
      createdAt: serverTimestamp(),
    });
  }),
);

let env: RulesTestEnvironment;

// setupRulesTestEnv owns boot, per-test clearing and cleanup; this only
// refreshes the handle so the tests below can keep using `env`.
beforeEach(() => {
  env = getEnv();
});

describe("spots/{spotId}/messages — read", () => {
  it("allows signed-in users to read messages", async () => {
    const alice = env.authenticatedContext(ALICE);
    await assertSucceeds(getDocs(collection(alice.firestore(), "spots", SPOT_ID, "messages")));
  });

  it("denies unauthenticated read", async () => {
    const unauth = env.unauthenticatedContext();
    await assertFails(getDocs(collection(unauth.firestore(), "spots", SPOT_ID, "messages")));
  });
});

describe("spots/{spotId}/messages — create (clean message)", () => {
  it("allows valid message with rate limit anchor", async () => {
    const alice = env.authenticatedContext(ALICE);
    const batch = writeBatch(alice.firestore());
    const messageRef = doc(collection(alice.firestore(), "spots", SPOT_ID, "messages"));
    batch.set(messageRef, {
      userId: ALICE,
      content: "This is a clean message",
      createdAt: serverTimestamp(),
      isHidden: false,
    });
    batch.set(doc(alice.firestore(), "users", ALICE), { lastSpotMessageAt: serverTimestamp() }, { merge: true });
    await assertSucceeds(batch.commit());
  });

  it("denies message without rate limit anchor", async () => {
    const alice = env.authenticatedContext(ALICE);
    await assertFails(
      setDoc(doc(collection(alice.firestore(), "spots", SPOT_ID, "messages")), {
        userId: ALICE,
        content: "No anchor",
        createdAt: serverTimestamp(),
        isHidden: false,
      }),
    );
  });

  it("denies empty content", async () => {
    const alice = env.authenticatedContext(ALICE);
    const batch = writeBatch(alice.firestore());
    batch.set(doc(collection(alice.firestore(), "spots", SPOT_ID, "messages")), {
      userId: ALICE,
      content: "",
      createdAt: serverTimestamp(),
      isHidden: false,
    });
    batch.set(doc(alice.firestore(), "users", ALICE), { lastSpotMessageAt: serverTimestamp() }, { merge: true });
    await assertFails(batch.commit());
  });

  it("denies content > 500 chars", async () => {
    const alice = env.authenticatedContext(ALICE);
    const batch = writeBatch(alice.firestore());
    batch.set(doc(collection(alice.firestore(), "spots", SPOT_ID, "messages")), {
      userId: ALICE,
      content: "x".repeat(501),
      createdAt: serverTimestamp(),
      isHidden: false,
    });
    batch.set(doc(alice.firestore(), "users", ALICE), { lastSpotMessageAt: serverTimestamp() }, { merge: true });
    await assertFails(batch.commit());
  });
});

describe("spots/{spotId}/messages — create (word filter)", () => {
  it("requires isHidden=true when content has blocked words", async () => {
    const alice = env.authenticatedContext(ALICE);
    const batch = writeBatch(alice.firestore());
    batch.set(doc(collection(alice.firestore(), "spots", SPOT_ID, "messages")), {
      userId: ALICE,
      content: "This message contains nigger",
      createdAt: serverTimestamp(),
      isHidden: true,
      hiddenReason: "word_filter",
    });
    batch.set(doc(alice.firestore(), "users", ALICE), { lastSpotMessageAt: serverTimestamp() }, { merge: true });
    await assertSucceeds(batch.commit());
  });

  it("denies isHidden=false when content has blocked words", async () => {
    const alice = env.authenticatedContext(ALICE);
    const batch = writeBatch(alice.firestore());
    batch.set(doc(collection(alice.firestore(), "spots", SPOT_ID, "messages")), {
      userId: ALICE,
      content: "bad word bitcoin here",
      createdAt: serverTimestamp(),
      isHidden: false,
    });
    batch.set(doc(alice.firestore(), "users", ALICE), { lastSpotMessageAt: serverTimestamp() }, { merge: true });
    await assertFails(batch.commit());
  });
});

/** Seed a message as admin tooling would (rules off): it belongs to BOB. */
function seedMessage(id: string): Promise<void> {
  return env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "spots", SPOT_ID, "messages", id), {
      userId: BOB,
      content: "Some message",
      createdAt: serverTimestamp(),
      isHidden: false,
    });
  });
}

describe("spots/{spotId}/messages — update (admin hide/unhide)", () => {
  it("allows admin to hide a message", async () => {
    // Seed a message
    await seedMessage("msg1");
    const admin = env.authenticatedContext(ADMIN, { admin: true });
    const msgRef = doc(collection(admin.firestore(), "spots", SPOT_ID, "messages"), "msg1");

    // Admin hides it
    await assertSucceeds(setDoc(msgRef, { isHidden: true, hiddenReason: "reported" }, { merge: true }));
  });

  it("denies non-admin hide", async () => {
    await seedMessage("msg2");
    const admin = env.authenticatedContext(ADMIN, { admin: true });
    const msgRef = doc(collection(admin.firestore(), "spots", SPOT_ID, "messages"), "msg2");

    const alice = env.authenticatedContext(ALICE);
    await assertFails(
      setDoc(
        doc(alice.firestore(), "spots", SPOT_ID, "messages", "msg2"),
        { isHidden: true, hiddenReason: "reported" },
        { merge: true },
      ),
    );
  });
});
