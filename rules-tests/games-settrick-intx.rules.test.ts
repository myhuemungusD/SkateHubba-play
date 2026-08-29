/**
 * setTrick end-to-end rules probe — the WHOLE transaction, not its halves.
 *
 * `setTrick` (src/services/games.match.ts) commits TWO writes in one
 * `runTransaction`: the /games setting→matching update and the matcher's
 * /notifications create (Path B of the companion-write rule, anchored on
 * `getAfter(games).updatedAt == request.time`).
 *
 * Every other suite exercises those writes SINGLY — the games red-teams send
 * a lone `updateDoc`, the notifications companion-write red-team sends a
 * `writeBatch` carrying the notification plus a hand-rolled anchor. Neither
 * shape reproduces the real commit, so a rule regression that only bites when
 * both writes ride together (document-access ceiling, expression budget, or a
 * getAfter anchor that stops resolving) reports green across the whole rules
 * suite and fails for real players on the core loop.
 *
 * This suite issues the transaction exactly as the service does.
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertFails, assertSucceeds, type RulesTestContext } from "@firebase/rules-unit-testing";
import { collection, doc, runTransaction, serverTimestamp } from "firebase/firestore";
import { authedContext, gameDoc, seedGameForUpdate, settingToMatchingUpdate, setupRulesTestEnv } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-settrick-intx";

const SETTER_UID = "setter-dana";
const MATCHER_UID = "matcher-eli";
const GAME_ID = "g-settrick";

const getEnv = setupRulesTestEnv(PROJECT_ID, (env) =>
  seedGameForUpdate(env, GAME_ID, { player1Uid: SETTER_UID, player2Uid: MATCHER_UID }),
);

/**
 * Replays `setTrick`'s transaction body verbatim: read the game, update it
 * setting→matching, and set the matcher's "your turn" notification on a
 * freshly-minted doc ref — all inside one `runTransaction`.
 */
async function runSetTrickTransaction(ctx: RulesTestContext, videoUrl?: null): Promise<void> {
  const db = ctx.firestore();
  await runTransaction(db, async (tx) => {
    const gameRef = gameDoc(ctx, GAME_ID);
    await tx.get(gameRef);
    tx.update(gameRef, settingToMatchingUpdate(MATCHER_UID, videoUrl === null ? { currentTrickVideoUrl: null } : {}));
    tx.set(doc(collection(db, "notifications")), {
      senderUid: SETTER_UID,
      recipientUid: MATCHER_UID,
      type: "your_turn",
      title: "Your Turn!",
      body: "Match @alice's kickflip",
      gameId: GAME_ID,
      read: false,
      createdAt: serverTimestamp(),
    });
  });
}

describe("setTrick — game update + notification create in ONE transaction", () => {
  it("commits: the core loop's setting→matching write is allowed as shipped", async () => {
    await assertSucceeds(runSetTrickTransaction(authedContext(getEnv(), SETTER_UID)));
  });

  // The videoUrl argument of `setTrick` is typed `string | null`, and the UI
  // really can reach it with null: useMediaRecorder fires `onRecorded(null)`
  // on a zero-byte take (the iOS Safari encoder failure its own comment
  // documents), useGamePlayController's `handleRecorded` marks the take
  // RECORDED anyway, and the setter's "✓ Landed" button submits the null
  // blob. The setting→matching branch requires a bucket-pinned
  // currentTrickVideoUrl, and `videoUrlBucketPinned(null)` is false — so the
  // whole transaction is denied and the setter cannot advance the game.
  it("denies a null trick video — the setter cannot advance the game", async () => {
    await assertFails(runSetTrickTransaction(authedContext(getEnv(), SETTER_UID), null));
  });
});
