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
import { doc, getDoc, setDoc, serverTimestamp, Timestamp } from "firebase/firestore";
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
    // two registered tokens, and a fresh notification_limits anchor so the
    // happy-path test can succeed.
    await setDoc(
      doc(ctx.firestore(), "games", GAME_ID),
      makeValidGame({ player1Uid: SENDER_UID, player2Uid: RECIPIENT_UID }),
    );
    await setDoc(doc(ctx.firestore(), "pushTargets", RECIPIENT_UID), {
      tokens: ["recipient-token-1", "recipient-token-2"],
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(ctx.firestore(), "notification_limits", `${SENDER_UID}_${GAME_ID}_your_turn`), {
      senderUid: SENDER_UID,
      gameId: GAME_ID,
      type: "your_turn",
      lastSentAt: serverTimestamp(),
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

describe("push_dispatch — happy path", () => {
  it("legitimate: a game participant can dispatch with valid tokens, payload, and rate anchor", async () => {
    await assertSucceeds(setDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID), validDispatch()));
  });

  it("legitimate: dispatch with multiple tokens that ALL appear in the mirror", async () => {
    await assertSucceeds(
      setDoc(
        doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID),
        validDispatch({ tokens: ["recipient-token-1", "recipient-token-2"] }),
      ),
    );
  });
});

describe("push_dispatch — sender / recipient gating", () => {
  it("attack: outsider (not in the game) CANNOT dispatch even with a valid mirror", async () => {
    // Even with everything else valid, a stranger cannot wake another
    // user's device — they're not a participant.
    await assertFails(
      setDoc(
        doc(asUser(OUTSIDER_UID).firestore(), "push_dispatch", DISPATCH_ID),
        validDispatch({ senderUid: OUTSIDER_UID }),
      ),
    );
  });

  it("attack: sender CANNOT spoof a different senderUid in the payload", async () => {
    await assertFails(
      setDoc(
        doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID),
        validDispatch({ senderUid: OUTSIDER_UID }),
      ),
    );
  });

  it("attack: sender CANNOT target a recipient who is not a participant", async () => {
    await assertFails(
      setDoc(
        doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID),
        validDispatch({ recipientUid: OUTSIDER_UID }),
      ),
    );
  });

  it("attack: sender CANNOT target themselves (recipientUid != senderUid)", async () => {
    await assertFails(
      setDoc(
        doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID),
        validDispatch({ recipientUid: SENDER_UID }),
      ),
    );
  });
});

describe("push_dispatch — token integrity", () => {
  it("attack: sender CANNOT inject a token that is NOT in the recipient's mirror", async () => {
    // The core abuse this rule blocks: a sender writes their OWN device
    // token (or one scraped from another collection) and tricks the
    // Extension into delivering pushes to the wrong device.
    await assertFails(
      setDoc(
        doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID),
        validDispatch({ tokens: ["recipient-token-1", "spoofed-token"] }),
      ),
    );
  });

  it("attack: dispatch with zero tokens rejected (no fan-out target)", async () => {
    await assertFails(
      setDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID), validDispatch({ tokens: [] })),
    );
  });

  it("attack: dispatch with > 10 tokens rejected (caps FCM API fan-out per event)", async () => {
    const tooMany = Array.from({ length: 11 }, (_, i) => `recipient-token-${i}`);
    await assertFails(
      setDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID), validDispatch({ tokens: tooMany })),
    );
  });
});

describe("push_dispatch — payload caps", () => {
  it("attack: title longer than 80 chars rejected", async () => {
    await assertFails(
      setDoc(
        doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID),
        validDispatch({ notification: { title: "A".repeat(81), body: "ok" } }),
      ),
    );
  });

  it("attack: body longer than 200 chars rejected", async () => {
    await assertFails(
      setDoc(
        doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID),
        validDispatch({ notification: { title: "ok", body: "B".repeat(201) } }),
      ),
    );
  });

  it("attack: unrecognised notification type rejected", async () => {
    await assertFails(
      setDoc(
        doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID),
        validDispatch({ type: "spam_payload", data: { gameId: GAME_ID, type: "spam_payload", click_action: "/x" } }),
      ),
    );
  });
});

// Helper: drop the limits doc and reseed games with an optional updatedAt
// override. Used by both rate-anchor cases — extracted to dodge the test-
// duplication gate and keep the two cases parametrized on a single shape.
async function resetAnchors(updatedAt?: Timestamp): Promise<void> {
  await getEnv().withSecurityRulesDisabled(async (ctx) => {
    const { deleteDoc } = await import("firebase/firestore");
    await deleteDoc(doc(ctx.firestore(), "notification_limits", `${SENDER_UID}_${GAME_ID}_your_turn`));
    await setDoc(
      doc(ctx.firestore(), "games", GAME_ID),
      makeValidGame({ player1Uid: SENDER_UID, player2Uid: RECIPIENT_UID }, updatedAt ? { updatedAt } : {}),
    );
  });
}

describe("push_dispatch — rate anchor", () => {
  it("attack: no notification_limits + stale games.updatedAt → dispatch rejected", async () => {
    // Stale (>10s) games.updatedAt fails the anchor's lower bound.
    await resetAnchors(Timestamp.fromMillis(Date.now() - 60 * 1000));
    await assertFails(setDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID), validDispatch()));
  });

  it("legitimate: fresh games.updatedAt alone satisfies the anchor (in-tx path)", async () => {
    // The in-tx writer doesn't write notification_limits — its anchor is
    // the games doc itself, updated in the same transaction.
    await resetAnchors();
    await assertSucceeds(setDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID), validDispatch()));
  });
});

describe("push_dispatch — immutability + reads", () => {
  it("attack: nobody can update a committed dispatch doc", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "push_dispatch", DISPATCH_ID), {
        ...validDispatch(),
        createdAt: Timestamp.now(),
      });
    });
    const { updateDoc } = await import("firebase/firestore");
    await assertFails(
      updateDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID), {
        notification: { title: "tampered", body: "x" },
      }),
    );
  });

  it("attack: nobody can delete a committed dispatch doc (Extension cleans up via Admin SDK)", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "push_dispatch", DISPATCH_ID), {
        ...validDispatch(),
        createdAt: Timestamp.now(),
      });
    });
    const { deleteDoc } = await import("firebase/firestore");
    await assertFails(deleteDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID)));
  });

  it("legitimate: sender and recipient can read; outsider cannot", async () => {
    await getEnv().withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "push_dispatch", DISPATCH_ID), {
        ...validDispatch(),
        createdAt: Timestamp.now(),
      });
    });
    await assertSucceeds(getDoc(doc(asUser(SENDER_UID).firestore(), "push_dispatch", DISPATCH_ID)));
    await assertSucceeds(getDoc(doc(asUser(RECIPIENT_UID).firestore(), "push_dispatch", DISPATCH_ID)));
    await assertFails(getDoc(doc(asUser(OUTSIDER_UID).firestore(), "push_dispatch", DISPATCH_ID)));
  });
});
