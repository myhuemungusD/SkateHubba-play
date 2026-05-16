/**
 * push_dispatch/{id} — Firebase Extension dispatch trigger.
 *
 * Red-team the create rule that gates client writes to the
 * `firebase/firestore-send-fcm` Extension's trigger collection. The
 * Extension runs as Admin SDK so it bypasses these rules; this suite
 * exercises the CLIENT-facing surface that an attacker can reach.
 *
 * Properties under test:
 *   1. Sender must own the auth uid
 *   2. Sender + recipient must both be game participants (player OR judge)
 *   3. Tokens MUST be a subset of recipient's /pushTargets mirror
 *   4. Title ≤ 80, body ≤ 200 (matches /notifications caps)
 *   5. Rate anchor: a fresh /notification_limits or /games update by the
 *      same sender for the same (game, type) must exist within 10s
 *   6. Dispatch docs are immutable (update + delete denied)
 *
 * Run via:  npm run test:rules
 */
import { describe, it } from "vitest";
import { assertSucceeds, assertFails, type RulesTestContext } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, serverTimestamp, writeBatch, type Firestore } from "firebase/firestore";
import { setupRulesTestEnv, makeValidGame } from "./_fixtures";

const PROJECT_ID = "demo-skatehubba-rules-pushdispatch-redteam";

const SENDER_UID = "sender-alice";
const RECIPIENT_UID = "recipient-bob";
const OUTSIDER_UID = "outsider-eve";
const GAME_ID = "game-1";
const DISPATCH_ID = "dispatch-1";

const getEnv = setupRulesTestEnv(PROJECT_ID, async (env) => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    // Seed: game with sender+recipient as players, recipient's mirror with
    // two registered tokens. The dispatch_limits doc is intentionally NOT
    // pre-seeded — the new rule requires it to be a SAME-BATCH companion
    // write, so each test commits both docs together.
    await setDoc(
      doc(ctx.firestore(), "games", GAME_ID),
      makeValidGame({ player1Uid: SENDER_UID, player2Uid: RECIPIENT_UID }),
    );
    await setDoc(doc(ctx.firestore(), "pushTargets", RECIPIENT_UID), {
      tokens: ["recipient-token-1", "recipient-token-2"],
      updatedAt: serverTimestamp(),
    });
  });
});

function asUser(uid: string): RulesTestContext {
  return getEnv().authenticatedContext(uid, { email_verified: true });
}

function validDispatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tokens: ["recipient-token-1"],
    notification: { title: "Your Turn!", body: "Match it" },
    data: { gameId: GAME_ID, type: "your_turn", click_action: `/?game=${GAME_ID}` },
    senderUid: SENDER_UID,
    recipientUid: RECIPIENT_UID,
    gameId: GAME_ID,
    type: "your_turn",
    createdAt: serverTimestamp(),
    ...overrides,
  };
}

function limitKey(senderUid: string, recipientUid: string, gameId: string, type: string): string {
  return `${senderUid}_${recipientUid}_${gameId}_${type}`;
}

interface CommitOpts {
  /** Skip writing the companion limits doc (negative-test path). */
  skipLimit?: boolean;
  /** Override the limits-doc payload (for back-date / spoof attacks). */
  limitOverrides?: Record<string, unknown>;
  /** Override the limits-doc id (defaults to the matching key). */
  limitId?: string;
}

/**
 * Commit /push_dispatch + /push_dispatch_limits in a single writeBatch —
 * the shape every legit client write takes. Tests pass overrides to
 * exercise rule branches without copy/pasting the batch boilerplate.
 */
function commitDispatch(
  fs: Firestore,
  dispatchOverrides: Record<string, unknown> = {},
  opts: CommitOpts = {},
): Promise<void> {
  const dispatchData = validDispatch(dispatchOverrides);
  const sender = (dispatchData.senderUid as string) ?? SENDER_UID;
  const recipient = (dispatchData.recipientUid as string) ?? RECIPIENT_UID;
  const game = (dispatchData.gameId as string) ?? GAME_ID;
  const type = (dispatchData.type as string) ?? "your_turn";

  const batch = writeBatch(fs);
  batch.set(doc(fs, "push_dispatch", DISPATCH_ID), dispatchData);
  if (!opts.skipLimit) {
    const id = opts.limitId ?? limitKey(sender, recipient, game, type);
    batch.set(doc(fs, "push_dispatch_limits", id), {
      senderUid: sender,
      recipientUid: recipient,
      gameId: game,
      type,
      lastSentAt: serverTimestamp(),
      ...opts.limitOverrides,
    });
  }
  return batch.commit();
}

describe("push_dispatch — happy path", () => {
  it("legitimate: a game participant can dispatch with the companion limits doc in the same batch", async () => {
    await assertSucceeds(commitDispatch(asUser(SENDER_UID).firestore()));
  });

  it("legitimate: dispatch with multiple tokens that ALL appear in the mirror", async () => {
    await assertSucceeds(
      commitDispatch(asUser(SENDER_UID).firestore(), { tokens: ["recipient-token-1", "recipient-token-2"] }),
    );
  });
});

describe("push_dispatch — sender / recipient gating", () => {
  it("attack: outsider (not in the game) CANNOT dispatch even with a valid mirror", async () => {
    // Even with everything else valid, a stranger cannot wake another
    // user's device — they're not a participant.
    await assertFails(commitDispatch(asUser(OUTSIDER_UID).firestore(), { senderUid: OUTSIDER_UID }));
  });

  it("attack: sender CANNOT spoof a different senderUid in the payload", async () => {
    await assertFails(commitDispatch(asUser(SENDER_UID).firestore(), { senderUid: OUTSIDER_UID }));
  });

  it("attack: sender CANNOT target a recipient who is not a participant", async () => {
    await assertFails(commitDispatch(asUser(SENDER_UID).firestore(), { recipientUid: OUTSIDER_UID }));
  });

  it("attack: sender CANNOT target themselves (recipientUid != senderUid)", async () => {
    await assertFails(commitDispatch(asUser(SENDER_UID).firestore(), { recipientUid: SENDER_UID }));
  });
});

describe("push_dispatch — token integrity", () => {
  it("attack: sender CANNOT inject a token that is NOT in the recipient's mirror", async () => {
    // The core abuse this rule blocks: a sender writes their OWN device
    // token (or one scraped from another collection) and tricks the
    // Extension into delivering pushes to the wrong device.
    await assertFails(
      commitDispatch(asUser(SENDER_UID).firestore(), { tokens: ["recipient-token-1", "spoofed-token"] }),
    );
  });

  it("attack: dispatch with zero tokens rejected (no fan-out target)", async () => {
    await assertFails(commitDispatch(asUser(SENDER_UID).firestore(), { tokens: [] }));
  });

  it("attack: dispatch with > 10 tokens rejected (caps FCM API fan-out per event)", async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `recipient-token-${i}`);
    await assertFails(commitDispatch(asUser(SENDER_UID).firestore(), { tokens: tooMany }));
  });
});

describe("push_dispatch — payload caps", () => {
  it("attack: title longer than 80 chars rejected", async () => {
    await assertFails(
      commitDispatch(asUser(SENDER_UID).firestore(), { notification: { title: "A".repeat(81), body: "ok" } }),
    );
  });

  it("attack: body longer than 200 chars rejected", async () => {
    await assertFails(
      commitDispatch(asUser(SENDER_UID).firestore(), { notification: { title: "ok", body: "B".repeat(201) } }),
    );
  });

  it("attack: unrecognised notification type rejected", async () => {
    await assertFails(
      commitDispatch(asUser(SENDER_UID).firestore(), {
        type: "spam_payload",
        data: { gameId: GAME_ID, type: "spam_payload", click_action: "/x" },
      }),
    );
  });
});

describe("push_dispatch — companion-write rate limit (Codex P1 hardening)", () => {
  it("attack: dispatch WITHOUT the companion /push_dispatch_limits doc is rejected", async () => {
    // The whole point of the new gate: a malicious client that skips the
    // limits-doc commit cannot create a dispatch doc, even with everything
    // else valid. Without this, one legit notification anchor authorized
    // unbounded /push_dispatch fan-out within the recency window.
    await assertFails(commitDispatch(asUser(SENDER_UID).firestore(), {}, { skipLimit: true }));
  });

  it("attack: companion limits doc with mismatched id is rejected", async () => {
    // Doc id MUST be the deterministic key. If the client writes the limits
    // doc under a different id, the dispatch's getAfter() lookup misses it.
    await assertFails(commitDispatch(asUser(SENDER_UID).firestore(), {}, { limitId: "wrong-bucket-key" }));
  });

  it("attack: a SECOND dispatch within 5s for the same (recipient, game, type) is rejected", async () => {
    // Codex P1: prove that a single legitimate dispatch can no longer
    // authorize a burst of follow-up dispatches. The first commit succeeds;
    // the second hits the limits-doc 5s update cooldown and the
    // /push_dispatch create rule fails its companion getAfter() check.
    await assertSucceeds(commitDispatch(asUser(SENDER_UID).firestore()));
    await assertFails(commitDispatch(asUser(SENDER_UID).firestore()));
  });

  it("attack: companion-write payload backfills lastSentAt with a stale ts → both writes rejected", async () => {
    // Without the server-time pin a sender could seed the cooldown anchor
    // with a value that immediately satisfies the 5s gate on every update.
    await assertFails(
      commitDispatch(
        asUser(SENDER_UID).firestore(),
        {},
        {
          limitOverrides: { lastSentAt: new Date(Date.now() - 60 * 60 * 1000) },
        },
      ),
    );
  });
});

describe("push_dispatch — immutability + reads", () => {
  it("attack: nobody can update a committed dispatch doc", async () => {
    await commitDispatch(asUser(SENDER_UID).firestore());
    const { updateDoc } = await import("firebase/firestore");
    await assertFails(
      updateDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID), {
        notification: { title: "tampered", body: "x" },
      }),
    );
  });

  it("attack: nobody can delete a committed dispatch doc (Extension cleans up via Admin SDK)", async () => {
    await commitDispatch(asUser(SENDER_UID).firestore());
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(deleteDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID)));
  });

  it("legitimate: sender and recipient can read; outsider cannot", async () => {
    await commitDispatch(asUser(SENDER_UID).firestore());
    await assertSucceeds(getDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID)));
    await assertSucceeds(getDoc(doc(asUser(RECIPIENT_UID).firestore(), "push_dispatch", DISPATCH_ID)));
    await assertFails(getDoc(doc(asUser(OUTSIDER_UID).firestore(), "push_dispatch", DISPATCH_ID)));
  });
});
