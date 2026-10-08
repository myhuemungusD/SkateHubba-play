/**
 * Games create — the 30s cooldown must be anchored in the SAME write.
 *
 * The /games create rule used to read users/{uid}.lastGameCreatedAt with a
 * plain get(), while the client stamped that anchor in a separate,
 * best-effort setDoc AFTER the game write. A client that simply never sent
 * the anchor update therefore never started a cooldown and could create
 * games back to back. The rule now also requires
 * getAfter(users/{uid}).lastGameCreatedAt == request.time, i.e. the anchor
 * must be stamped in the same batch as the create (which is what
 * src/services/games.create.ts now does).
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, writeBatch } from "firebase/firestore";
import { createGameWithAnchor, setupRulesTestEnv, authedContext, gameDoc, makeValidGame } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-games-create-cooldown";

const CHALLENGER_UID = "cooldown-challenger";
const OPPONENT_UID = "cooldown-opponent";
const PLAYERS = {
  player1Uid: CHALLENGER_UID,
  player2Uid: OPPONENT_UID,
  player1Username: "challenger",
  player2Username: "opponent",
};

const getEnv = setupRulesTestEnv(PROJECT_ID, async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "users", CHALLENGER_UID), { uid: CHALLENGER_UID, username: "challenger" });
    await setDoc(doc(ctx.firestore(), "users", OPPONENT_UID), { uid: OPPONENT_UID, username: "opponent" });
  });
});

/** Back-date (or forward-date) the challenger's stored cooldown anchor. */
async function seedAnchor(msAgo: number): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    await setDoc(
      doc(ctx.firestore(), "users", CHALLENGER_UID),
      { lastGameCreatedAt: new Date(Date.now() - msAgo) },
      { merge: true },
    );
  });
}

function challengerGame(gameId: string) {
  return gameDoc(authedContext(getEnv(), CHALLENGER_UID), gameId);
}

describe("games create — cooldown anchor must ride the same batch", () => {
  it("allowed: first-ever game with the anchor stamped in the same batch", async () => {
    await assertSucceeds(createGameWithAnchor(challengerGame("cd-first"), makeValidGame(PLAYERS)));
  });

  it("allowed: the previous game is older than 30s and the batch re-stamps the anchor", async () => {
    await seedAnchor(60_000);
    await assertSucceeds(createGameWithAnchor(challengerGame("cd-after-window"), makeValidGame(PLAYERS)));
  });

  it("blocked: a bare create that never writes the anchor (the old bypass)", async () => {
    await assertFails(setDoc(challengerGame("cd-bare-first"), makeValidGame(PLAYERS)));
  });

  it("blocked: a bare create even when the stored anchor is outside the window", async () => {
    await seedAnchor(60_000);
    await assertFails(setDoc(challengerGame("cd-bare-old"), makeValidGame(PLAYERS)));
  });

  it("blocked: an anchored create inside the 30s window", async () => {
    await seedAnchor(5_000);
    await assertFails(createGameWithAnchor(challengerGame("cd-in-window"), makeValidGame(PLAYERS)));
  });

  it("blocked: a second anchored create straight after the first", async () => {
    await assertSucceeds(createGameWithAnchor(challengerGame("cd-burst-1"), makeValidGame(PLAYERS)));
    await assertFails(createGameWithAnchor(challengerGame("cd-burst-2"), makeValidGame(PLAYERS)));
  });

  it("blocked: a batch whose anchor carries a client clock instead of serverTimestamp()", async () => {
    const ref = challengerGame("cd-client-clock");
    const batch = writeBatch(ref.firestore);
    batch.set(ref, makeValidGame(PLAYERS));
    batch.set(doc(ref.firestore, "users", CHALLENGER_UID), { lastGameCreatedAt: new Date() }, { merge: true });
    await assertFails(batch.commit());
  });
});
