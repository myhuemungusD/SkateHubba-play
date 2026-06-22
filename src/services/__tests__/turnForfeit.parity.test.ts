/**
 * PARITY test: the server's admin-SDK write translation
 * (`toAdminGameUpdate`, api/cron/sweep-expired-turns.ts) must produce the same
 * logical write as the client's web-SDK translation (`toWebGameUpdate`,
 * games.turns.ts) for EVERY forfeit branch.
 *
 * This is the highest-value guard against client/server drift: both translate
 * the SDK-agnostic `ForfeitGameUpdate` from `decideExpiredForfeit`, but each
 * uses a different Firebase SDK's Timestamp / FieldValue. If a future edit
 * changes one mapping and not the other, the persisted game doc diverges and a
 * server-forfeited game would look different from a client-forfeited one.
 *
 * Strategy: mock BOTH SDKs' Timestamp / serverTimestamp / arrayUnion to emit
 * IDENTICAL sentinel shapes. Then a forfeit decision passed through each
 * translator must yield deep-equal objects:
 *   • serverTimestamp()        → { __serverTs: true }
 *   • Timestamp.fromMillis(ms) → { __ts: ms }
 *   • arrayUnion(record)       → { __arrayUnion: record }
 * So timestamps compare by ms, the appended TurnRecord compares structurally,
 * and the landed-clip writes (asserted separately) line up field-for-field.
 */
import { describe, it, expect, vi } from "vitest";

// ── Identical sentinels for both SDKs ───────────────────────────────────────
const SERVER_TS = { __serverTs: true };
const ts = (ms: number) => ({ __ts: ms });
const arrayUnion = (v: unknown) => ({ __arrayUnion: v });

// Web SDK (firebase/firestore) — consumed by games.turns.ts.
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(),
  doc: vi.fn(),
  runTransaction: vi.fn(),
  serverTimestamp: () => SERVER_TS,
  arrayUnion: (v: unknown) => arrayUnion(v),
  Timestamp: { fromMillis: (ms: number) => ts(ms) },
}));

// Admin SDK (firebase-admin/firestore) — consumed by the cron handler.
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: vi.fn(),
  FieldValue: {
    serverTimestamp: () => SERVER_TS,
    arrayUnion: (v: unknown) => arrayUnion(v),
  },
  Timestamp: { fromMillis: (ms: number) => ts(ms) },
}));
vi.mock("firebase-admin/app", () => ({
  getApps: vi.fn(() => []),
  initializeApp: vi.fn(),
  cert: vi.fn(),
}));

// Transitive deps of games.turns.ts we don't exercise here.
vi.mock("../../firebase");
vi.mock("../clips", () => ({ writeLandedClipsInTransaction: vi.fn() }));
vi.mock("../logger", () => ({ metrics: { gameForfeit: vi.fn() } }));

import { toWebGameUpdate } from "../games.turns";
import { toAdminGameUpdate } from "../../../api/cron/sweep-expired-turns";
import { decideExpiredForfeit } from "../turnForfeit.shared";
import { TURN_DURATION_MS } from "../turnDuration";
import { FORFEIT_NOW as NOW, makeGameDoc as baseGame } from "./turnForfeit.test-helpers";
import type { GameDoc } from "../games.mappers";

/** Run a game through the shared decision, then both translators. */
function bothWrites(game: GameDoc) {
  const decision = decideExpiredForfeit(game, NOW, "g1");
  expect(decision).not.toBeNull();
  const web = toWebGameUpdate(decision!.gameUpdate);
  const admin = toAdminGameUpdate(decision!.gameUpdate);
  return { decision: decision!, web, admin };
}

/**
 * Assert the SDK-agnostic decision's notification targets the matcher (p2) as a
 * "your_turn" alert with the CANONICAL sender (the setter, p1). Shared by both
 * turn-advancing branches — the notification descriptor is part of the decision,
 * not the per-SDK game-state write.
 *
 * IMPORTANT — senderUid is intentionally PATH-SPECIFIC at materialization time:
 *   • The shared decision (asserted here) carries the canonical sender = setter.
 *   • The SERVER sweep (admin SDK, bypasses rules) writes that canonical sender
 *     verbatim.
 *   • The CLIENT (games.turns.ts) overrides senderUid = callerUid (the
 *     authenticated writer) so the /notifications create rule
 *     (senderUid == request.auth.uid) accepts the write — critical for the
 *     judge-as-caller case where the caller is not the setter.
 * The recipient and type are identical across paths; only the writer differs.
 */
function expectMatcherNotification(notification: unknown): void {
  expect(notification).toEqual({
    recipientUid: "p2",
    senderUid: "p1",
    type: "your_turn",
    title: expect.any(String),
    body: expect.any(String),
  });
}

describe("toAdminGameUpdate / toWebGameUpdate parity", () => {
  it("plain forfeit (setting/matching) — identical write", () => {
    const { decision, web, admin } = bothWrites(baseGame({ currentTurn: "p1", currentSetter: "p1" }));

    // Byte-for-byte identical given the shared sentinel mocks.
    expect(admin).toEqual(web);

    // Spot-check the load-bearing values rather than trusting toEqual alone.
    expect(admin.updatedAt).toEqual(SERVER_TS);
    expect(admin.status).toBe("forfeit");
    expect(admin.winner).toBe("p2");
    expect(admin.turnHistory).toEqual(
      arrayUnion(web.turnHistory ? (web.turnHistory as { __arrayUnion: unknown }).__arrayUnion : undefined),
    );
    // Game ends — no "your turn" notification on either path.
    expect(decision.notification).toBeNull();
  });

  it("disputeAccept (disputable phase expired) — identical write incl. Timestamp + arrayUnion", () => {
    const { decision, web, admin } = bothWrites(
      baseGame({ phase: "disputable", currentSetter: "p1", currentTurn: "p1" }),
    );
    expect(decision.kind).toBe("disputeAccept");
    expect(admin).toEqual(web);

    // turnDeadline must be the same epoch-ms Timestamp on both sides.
    expect(admin.turnDeadline).toEqual(ts(NOW + TURN_DURATION_MS));
    expect(admin.turnDeadline).toEqual(web.turnDeadline);
    // The appended TurnRecord must be identical (same arrayUnion payload).
    expect(admin.turnHistory).toEqual(web.turnHistory);
    expect(admin.turnNumber).toBe(web.turnNumber);
    expect(admin.judgeReviewFor).toBeNull();
    // The notification is part of the shared decision (recipient = matcher who
    // landed and now sets) — NOT part of the game-state write. Both SDK paths
    // read this same value; only the client may skip EMITTING it (self-notify).
    expectMatcherNotification(decision.notification);
    // The game-state write carries NO notification fields — divergence is only
    // in the side-effect emission, never in the persisted game doc.
    expect(web).not.toHaveProperty("recipientUid");
    expect(admin).not.toHaveProperty("recipientUid");
  });

  it("setReviewClear (setReview phase expired) — identical write", () => {
    const { decision, web, admin } = bothWrites(
      baseGame({
        phase: "setReview",
        currentSetter: "p1",
        currentTurn: "j1",
        judgeId: "j1",
        judgeStatus: "accepted",
      }),
    );
    expect(decision.kind).toBe("setReviewClear");
    expect(admin).toEqual(web);
    expect(admin.phase).toBe("matching");
    expect(admin.currentTurn).toBe("p2");
    expect(admin.turnDeadline).toEqual(ts(NOW + TURN_DURATION_MS));
    expect(admin.judgeReviewFor).toBeNull();
    // Only the fields the decision set are present — no stray keys on either side.
    expect(Object.keys(admin).sort()).toEqual(Object.keys(web).sort());
    // Notification recipient = matcher now on the clock; shared across paths.
    expectMatcherNotification(decision.notification);
  });

  it("never emits a key the other side omits (no partial drift on any branch)", () => {
    for (const game of [
      baseGame(),
      baseGame({ phase: "disputable" }),
      baseGame({ phase: "setReview", currentTurn: "j1", judgeId: "j1", judgeStatus: "accepted" }),
    ]) {
      const { web, admin } = bothWrites(game);
      expect(Object.keys(admin).sort()).toEqual(Object.keys(web).sort());
    }
  });
});
