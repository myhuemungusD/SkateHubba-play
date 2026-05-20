/**
 * Notifications — red-team tests for the title/body size caps added in
 * the April 2026 hardening pass.
 *
 * The in-app notification feed denormalizes user-generated strings into
 * the recipient's document stream. Without caps a malicious sender could
 * wedge multi-megabyte payloads into another user's feed (DoS via storage
 * amplification, and an App Store moderation surface). The hardened rule
 * caps title ≤ 80 and body ≤ 200.
 *
 * Run via:  npm run test:rules
 */
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { doc, setDoc, serverTimestamp, setLogLevel, writeBatch } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-notifications-redteam";

const SENDER_UID = "sender-alice";
const RECIPIENT_UID = "recipient-bob";
const GAME_ID = "shared-game";
const NOTIF_ID = "notif-1";

let testEnv: RulesTestEnvironment;

function makeValidGame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    player1Uid: SENDER_UID,
    player2Uid: RECIPIENT_UID,
    player1Username: "alice",
    player2Username: "bob",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: SENDER_UID,
    phase: "setting",
    currentSetter: SENDER_UID,
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnNumber: 1,
    winner: null,
    turnHistory: [],
    turnDeadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function makeValidNotification(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    senderUid: SENDER_UID,
    recipientUid: RECIPIENT_UID,
    type: "your_turn",
    title: "Your turn!",
    body: "Bob is waiting on you.",
    gameId: GAME_ID,
    read: false,
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function asSender(): RulesTestContext {
  return testEnv.authenticatedContext(SENDER_UID, { email_verified: true });
}

async function seedGame(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", GAME_ID), makeValidGame());
  });
}

beforeAll(async () => {
  setLogLevel("error");
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      host: "127.0.0.1",
      port: 8080,
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seedGame();
});

describe("notifications — red-team against title/body caps", () => {
  it("attack: sender CANNOT write a title longer than 80 chars (200-char payload)", async () => {
    await assertFails(
      setDoc(doc(asSender().firestore(), "notifications", NOTIF_ID), makeValidNotification({ title: "A".repeat(200) })),
    );
  });

  it("attack: sender CANNOT write a title of 81 chars (boundary)", async () => {
    await assertFails(
      setDoc(doc(asSender().firestore(), "notifications", NOTIF_ID), makeValidNotification({ title: "A".repeat(81) })),
    );
  });

  it("attack: sender CANNOT write a body longer than 200 chars (300-char payload)", async () => {
    await assertFails(
      setDoc(doc(asSender().firestore(), "notifications", NOTIF_ID), makeValidNotification({ body: "B".repeat(300) })),
    );
  });

  it("attack: sender CANNOT write a body of 201 chars (boundary)", async () => {
    await assertFails(
      setDoc(doc(asSender().firestore(), "notifications", NOTIF_ID), makeValidNotification({ body: "B".repeat(201) })),
    );
  });

  it("legitimate: short title and body within caps succeed", async () => {
    // After the H2 hardening, /notifications create needs a companion write
    // to /notification_limits in the same batch (or a games update — see
    // notifications-companion-write-redteam). Use the batch path so this
    // happy-path test exercises the realistic prod shape.
    const ctx = asSender();
    const notifRef = doc(ctx.firestore(), "notifications", NOTIF_ID);
    const limitRef = doc(ctx.firestore(), "notification_limits", `${SENDER_UID}_${GAME_ID}_your_turn`);
    const batch = writeBatch(ctx.firestore());
    batch.set(notifRef, makeValidNotification({ title: "A".repeat(80), body: "B".repeat(200) }));
    batch.set(limitRef, {
      senderUid: SENDER_UID,
      gameId: GAME_ID,
      type: "your_turn",
      lastSentAt: serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });
});
