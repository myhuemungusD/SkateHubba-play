/**
 * Trick picker fields, training consent, and the admin-only label collection.
 *
 * Run via: npm run test:rules
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
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, setLogLevel } from "firebase/firestore";

const PROJECT_ID = "demo-skatehubba-rules-trick-labels";
const P1 = "p1-alice";
const P2 = "p2-bob";
const GAME_ID = "g-tricks";
const VIDEO = "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/set.webm";

let testEnv: RulesTestEnvironment;

function asUser(uid: string, claims: Record<string, unknown> = {}): RulesTestContext {
  return testEnv.authenticatedContext(uid, { email_verified: true, ...claims });
}

function deadline(): Date {
  return new Date(Date.now() + 24 * 60 * 60 * 1000);
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
});

async function seedGame(overrides: Record<string, unknown> = {}): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "games", GAME_ID), {
      player1Uid: P1,
      player2Uid: P2,
      player1Username: "alice",
      player2Username: "bob",
      p1Letters: 0,
      p2Letters: 0,
      status: "active",
      currentTurn: P1,
      phase: "setting",
      currentSetter: P1,
      currentTrickName: null,
      currentTrickVideoUrl: null,
      matchVideoUrl: null,
      turnNumber: 1,
      winner: null,
      turnHistory: [],
      turnDeadline: deadline(),
      createdAt: serverTimestamp(),
      updatedAt: new Date(Date.now() - 60_000),
      ...overrides,
    });
  });
}

function setPayload(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    phase: "matching",
    currentTrickName: "Kickflip",
    currentTrickVideoUrl: VIDEO,
    currentTurn: P2,
    turnDeadline: deadline(),
    updatedAt: serverTimestamp(),
    ...extra,
  };
}

describe("trick fields on a set", () => {
  it("allows a legacy set with no structured fields", async () => {
    await seedGame();
    await assertSucceeds(updateDoc(doc(asUser(P1).firestore(), "games", GAME_ID), setPayload()));
  });

  it("allows a catalog pick and an Other name", async () => {
    await seedGame();
    await assertSucceeds(
      updateDoc(
        doc(asUser(P1).firestore(), "games", GAME_ID),
        setPayload({
          currentTrickName: "Switch Kickflip",
          currentTrickId: "kickflip",
          currentTrickStance: "switch",
          currentTrickObstacle: "ledge",
          currentTrickNameCustom: null,
        }),
      ),
    );

    await testEnv.clearFirestore();
    await seedGame();
    await assertSucceeds(
      updateDoc(
        doc(asUser(P1).firestore(), "games", GAME_ID),
        setPayload({
          currentTrickName: "Casper",
          currentTrickId: "other",
          currentTrickStance: "regular",
          currentTrickObstacle: "manual-pad",
          currentTrickNameCustom: "Casper",
        }),
      ),
    );
  });

  async function rejectSet(extra: Record<string, unknown>): Promise<void> {
    await assertFails(updateDoc(doc(asUser(P1).firestore(), "games", GAME_ID), setPayload(extra)));
  }

  it("rejects a bad stance, a missing Other name, and a too-long custom name", async () => {
    await seedGame();
    await rejectSet({
      currentTrickId: "kickflip",
      currentTrickStance: "goofy",
      currentTrickObstacle: null,
      currentTrickNameCustom: null,
    });
    await rejectSet({
      currentTrickId: "other",
      currentTrickStance: "regular",
      currentTrickObstacle: null,
      currentTrickNameCustom: null,
    });
    await rejectSet({
      currentTrickId: "other",
      currentTrickStance: "regular",
      currentTrickObstacle: "curb",
      currentTrickNameCustom: "x".repeat(65),
    });
  });

  it("allows a fail-set that nulls the trick fields", async () => {
    await seedGame({
      currentTrickId: "kickflip",
      currentTrickStance: "regular",
      currentTrickObstacle: "flat",
      currentTrickNameCustom: null,
    });
    await assertSucceeds(
      updateDoc(doc(asUser(P1).firestore(), "games", GAME_ID), {
        phase: "setting",
        currentSetter: P2,
        currentTurn: P2,
        currentTrickName: null,
        currentTrickVideoUrl: null,
        currentTrickId: null,
        currentTrickStance: null,
        currentTrickObstacle: null,
        currentTrickNameCustom: null,
        turnNumber: 2,
        turnDeadline: deadline(),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  it("lets the client raise trainingLabelPending and refuses to clear it", async () => {
    await seedGame();
    await assertSucceeds(
      updateDoc(doc(asUser(P1).firestore(), "games", GAME_ID), setPayload({ trainingLabelPending: true })),
    );

    await testEnv.clearFirestore();
    await seedGame({ trainingLabelPending: true });
    await assertFails(
      updateDoc(
        doc(asUser(P1).firestore(), "games", GAME_ID),
        setPayload({
          trainingLabelPending: false,
          currentTrickId: "kickflip",
          currentTrickStance: "regular",
          currentTrickObstacle: null,
          currentTrickNameCustom: null,
        }),
      ),
    );
  });
});

describe("trainingLabels and revocations", () => {
  it("is admin-read and closed to clients", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "trainingLabels", "g_1_set"), { ownerUid: P1, trickId: "kickflip" });
    });
    await assertFails(getDoc(doc(asUser(P1).firestore(), "trainingLabels", "g_1_set")));
    await assertFails(setDoc(doc(asUser(P1).firestore(), "trainingLabels", "g_1_match"), { ownerUid: P1 }));
    await assertSucceeds(getDoc(doc(asUser("admin", { admin: true }).firestore(), "trainingLabels", "g_1_set")));
  });

  it("lets the owner stamp a withdrawal and nobody else", async () => {
    await assertSucceeds(
      setDoc(doc(asUser(P1).firestore(), "trainingRevocations", P1), { revokedAt: serverTimestamp() }),
    );
    await assertFails(getDoc(doc(asUser(P1).firestore(), "trainingRevocations", P1)));
    await assertFails(deleteDoc(doc(asUser(P1).firestore(), "trainingRevocations", P1)));
    await assertFails(setDoc(doc(asUser(P2).firestore(), "trainingRevocations", P1), { revokedAt: serverTimestamp() }));
    await assertFails(
      setDoc(doc(asUser(P1).firestore(), "trainingRevocations", P1), {
        revokedAt: serverTimestamp(),
        extra: true,
      }),
    );
  });
});

describe("training consent on the private profile", () => {
  it("accepts a boolean opt-in and rejects a string", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", P1, "private", "profile"), {
        emailVerified: true,
        dob: "1990-01-01",
      });
    });
    await assertSucceeds(
      updateDoc(doc(asUser(P1).firestore(), "users", P1, "private", "profile"), {
        trainingConsentOptedIn: true,
        trainingConsentPolicyVersion: "2026-10-10",
        trainingConsentUpdatedAt: serverTimestamp(),
        trainingConsentRevokedAt: null,
        trainingConsentPromptSeenAt: serverTimestamp(),
      }),
    );
    await assertFails(
      updateDoc(doc(asUser(P1).firestore(), "users", P1, "private", "profile"), {
        trainingConsentOptedIn: "yes",
      }),
    );
  });
});
