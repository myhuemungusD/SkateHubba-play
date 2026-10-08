/**
 * Roll Dice collections are server-written.
 *
 * Clients may read a match they are in and a single diceStats doc. Every
 * client write is denied, including a player trying to award themselves a
 * 4-5-6. dice_turn notifications are written by the Admin SDK; the recipient
 * must still be able to mark one read and delete it even though gameId does
 * not point at /games.
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-dice";
const getEnv = setupRulesTestEnv(PROJECT_ID);

const P1 = "dice-p1";
const P2 = "dice-p2";
const STRANGER = "dice-stranger";

function game(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    playerUids: [P1, P2],
    player1Uid: P1,
    player2Uid: P2,
    status: "active",
    currentTurn: P1,
    round: 1,
    roundsWon: { [P1]: 0, [P2]: 0 },
    results: {},
    rollCount: 0,
    winner: null,
    updatedAt: 1,
    turnDeadline: 2,
    ...overrides,
  };
}

describe("diceGames", () => {
  it("lets a player read their match and denies everyone else", async () => {
    const env = getEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "diceGames", "g1"), game());
    });
    await assertSucceeds(getDoc(doc(env.authenticatedContext(P1).firestore(), "diceGames", "g1")));
    await assertFails(getDoc(doc(env.authenticatedContext(STRANGER).firestore(), "diceGames", "g1")));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "diceGames", "g1")));
  });

  it("lets a player list only matches that contain their uid", async () => {
    const env = getEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "diceGames", "g1"), game());
    });
    const db = env.authenticatedContext(P1).firestore();
    await assertSucceeds(getDocs(query(collection(db, "diceGames"), where("playerUids", "array-contains", P1))));
    await assertFails(getDocs(query(collection(db, "diceGames"), where("playerUids", "array-contains", P2))));
    await assertFails(getDocs(collection(db, "diceGames")));
  });

  it("denies every client write, including a player planting a winning roll", async () => {
    const env = getEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "diceGames", "g1"), game());
    });
    const db = env.authenticatedContext(P1).firestore();
    const ref = doc(db, "diceGames", "g1");
    await assertFails(setDoc(doc(db, "diceGames", "fresh"), game()));
    await assertFails(updateDoc(ref, { results: { [P1]: { dice: [4, 5, 6], rank: 1000 } } }));
    await assertFails(updateDoc(ref, { winner: P1, status: "forfeit" }));
    await assertFails(updateDoc(ref, { currentTurn: P2 }));
    await assertFails(updateDoc(ref, { turnDeadline: 9_999_999_999_999 }));
    await assertFails(deleteDoc(ref));
  });
});

describe("diceStats and diceCreateLimits", () => {
  it("lets any signed-in user read one stats doc and nobody list or write them", async () => {
    const env = getEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "diceStats", P1), { wins: 1, losses: 0, gamesPlayed: 1 });
    });
    const db = env.authenticatedContext(P2).firestore();
    await assertSucceeds(getDoc(doc(db, "diceStats", P1)));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "diceStats", P1)));
    await assertFails(getDocs(collection(db, "diceStats")));
    await assertFails(setDoc(doc(db, "diceStats", P2), { wins: 999, losses: 0, gamesPlayed: 999 }));
    await assertFails(updateDoc(doc(db, "diceStats", P1), { wins: 999 }));
  });

  it("hides the create-cooldown doc from clients", async () => {
    const env = getEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "diceCreateLimits", P1), { lastCreateAt: 1 });
    });
    const db = env.authenticatedContext(P1).firestore();
    await assertFails(getDoc(doc(db, "diceCreateLimits", P1)));
    await assertFails(setDoc(doc(db, "diceCreateLimits", P1), { lastCreateAt: 0 }));
  });
});

describe("dice notifications", () => {
  const createdAt = Timestamp.fromMillis(1_700_000_000_000);
  const notice = {
    senderUid: P1,
    recipientUid: P2,
    type: "dice_turn",
    title: "Roll Dice",
    body: "Your roll",
    gameId: "g1",
    read: false,
    createdAt,
  };

  it("lets the recipient mark a dice_turn read and delete it", async () => {
    const env = getEnv();
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "notifications", "n1"), notice);
    });
    const db = env.authenticatedContext(P2).firestore();
    await assertSucceeds(updateDoc(doc(db, "notifications", "n1"), { ...notice, read: true }));
    await assertSucceeds(deleteDoc(doc(db, "notifications", "n1")));
  });

  it("rejects a client-created dice_turn (the callable writes these)", async () => {
    const env = getEnv();
    const db = env.authenticatedContext(P1).firestore();
    await assertFails(setDoc(doc(db, "notifications", "spoof"), { ...notice, createdAt: Timestamp.now() }));
  });
});
