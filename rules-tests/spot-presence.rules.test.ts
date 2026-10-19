/**
 * Spot presence + online status rules: spot challenges need both players
 * present at the spot right now; presence docs are server-only; online
 * status is an owner-written heartbeat that never leaks when hidden.
 *
 *     npm run test:rules
 */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds } from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import * as fx from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules";
const P1 = "p1-alice";
const P2 = "p2-bob";
const SPOT = "11111111-2222-3333-4444-555555555555";
const OPTS = { player1Uid: P1, player2Uid: P2 };

const getEnv = fx.setupRulesTestEnv(PROJECT_ID, fx.seedGameProfiles);

async function seedHere(uid: string, minutesFromNow: number): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "spotPresence", SPOT, "here", uid), {
      uid,
      spotId: SPOT,
      username: uid,
      expiresAt: Timestamp.fromMillis(Date.now() + minutesFromNow * 60_000),
    });
  });
}

describe("spot challenge presence", () => {
  const create = (extra: Record<string, unknown>) =>
    fx.createGameWithAnchor(
      fx.gameDoc(fx.authedContext(getEnv(), P1), "g1"),
      fx.makeValidGame(OPTS, { spotId: SPOT, ...extra }),
    );

  it("accepts when both players are here", async () => {
    await seedHere(P1, 5);
    await seedHere(P2, 5);
    await assertSucceeds(create({ spotPresence: true }));
  });
  it("rejects when the opponent isn't here", async () => {
    await seedHere(P1, 5);
    await assertFails(create({ spotPresence: true }));
  });
  it("rejects when the challenger isn't here", async () => {
    await seedHere(P2, 5);
    await assertFails(create({ spotPresence: true }));
  });
  it("rejects lapsed presence", async () => {
    await seedHere(P1, 5);
    await seedHere(P2, -1);
    await assertFails(create({ spotPresence: true }));
  });
  it("rejects spotPresence without a spotId", async () => {
    await assertFails(
      fx.createGameWithAnchor(
        fx.gameDoc(fx.authedContext(getEnv(), P1), "g1"),
        fx.makeValidGame(OPTS, { spotPresence: true }),
      ),
    );
  });
  it("leaves ordinary spot games alone", async () => {
    await assertSucceeds(create({ spotPresence: false }));
  });
});

describe("spotPresence docs", () => {
  it("signed-in users read, nobody writes", async () => {
    await seedHere(P2, 5);
    const db = fx.authedContext(getEnv(), P1).firestore();
    await assertSucceeds(getDoc(doc(db, "spotPresence", SPOT, "here", P2)));
    await assertFails(setDoc(doc(db, "spotPresence", SPOT, "here", P1), { uid: P1, expiresAt: Timestamp.now() }));
    await assertFails(getDoc(doc(getEnv().unauthenticatedContext().firestore(), "spotPresence", SPOT, "here", P2)));
  });
});

describe("onlineStatus", () => {
  const ref = (as: string, uid: string) => doc(fx.authedContext(getEnv(), as).firestore(), "onlineStatus", uid);
  it("owner writes a server-clock heartbeat or a hidden marker", async () => {
    await assertSucceeds(setDoc(ref(P1, P1), { lastSeen: serverTimestamp(), hidden: false }));
    await assertSucceeds(setDoc(ref(P1, P1), { lastSeen: null, hidden: true }));
    await assertSucceeds(getDoc(ref(P2, P1)));
    await assertSucceeds(deleteDoc(ref(P1, P1)));
  });
  it("rejects forged clocks, leaks, extra keys, and other users", async () => {
    await assertFails(setDoc(ref(P1, P1), { lastSeen: Timestamp.now(), hidden: false }));
    await assertFails(setDoc(ref(P1, P1), { lastSeen: serverTimestamp(), hidden: true }));
    await assertFails(setDoc(ref(P1, P1), { lastSeen: serverTimestamp(), hidden: false, lat: 1 }));
    await assertFails(setDoc(ref(P1, P1), { lastSeen: serverTimestamp(), hidden: "no" }));
    await assertFails(setDoc(ref(P2, P1), { lastSeen: serverTimestamp(), hidden: false }));
  });
});
