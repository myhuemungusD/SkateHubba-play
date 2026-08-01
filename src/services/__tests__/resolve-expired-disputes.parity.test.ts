/**
 * PARITY test: the dispute referee's admin-SDK write translation
 * (`toAdminDisputeUpdate`, api/cron/resolve-expired-disputes.ts) must produce
 * the same logical game-doc write a web client would persist from the SAME
 * `DisputeGameUpdate` produced by the shared resolution helper.
 *
 * There is no production web resolution path today (the referee is the only
 * writer — resolution is admin-only per DISPUTE_BINDING_DESIGN §5). So the
 * "web client would write" side is expressed here as a reference web-SDK
 * translation (`toWebDisputeUpdate`) that applies `firebase/firestore`'s
 * serverTimestamp / Timestamp / arrayUnion field-for-field the way every other
 * web write in this codebase does (see toWebGameUpdate in games.turns.ts). If a
 * future edit changes the admin translator without matching the canonical web
 * materialization, the persisted game doc would diverge — this test fails first.
 *
 * Strategy (mirrors sweep-expired-turns.parity.test.ts): mock BOTH SDKs'
 * Timestamp / serverTimestamp / arrayUnion to emit IDENTICAL sentinel shapes, so
 * a decision's gameUpdate passed through each translator must be deep-equal:
 *   • serverTimestamp()        → { __serverTs: true }
 *   • Timestamp.fromMillis(ms) → { __ts: ms }
 *   • arrayUnion(record)       → { __arrayUnion: record }
 */
import { describe, it, expect, vi } from "vitest";

// ── Identical sentinels for both SDKs ───────────────────────────────────────
const SERVER_TS = { __serverTs: true };
const ts = (ms: number) => ({ __ts: ms });
const arrayUnion = (v: unknown) => ({ __arrayUnion: v });

// Web SDK (firebase/firestore) — used by the reference web translator below.
vi.mock("firebase/firestore", () => ({
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

import { serverTimestamp, arrayUnion as webArrayUnion, Timestamp as WebTimestamp } from "firebase/firestore";
import { toAdminDisputeUpdate } from "../../../api/cron/resolve-expired-disputes";
import {
  decideDisputeResolution,
  decidePendingReviewExpiry,
  type DisputeGameUpdate,
} from "../dispute.resolution.shared";
import { TURN_DURATION_MS } from "../turnDuration";
import { DISPUTE_NOW as NOW, makeDisputeGame as baseGame } from "./dispute.resolution.test-helpers";

/**
 * Canonical web-SDK materialization of a `DisputeGameUpdate`. Mirrors
 * `toAdminDisputeUpdate` exactly, but uses the web SDK's serverTimestamp /
 * Timestamp / arrayUnion — the same primitives games.turns.ts uses. This is the
 * document a client would persist from the shared helper's output.
 */
function toWebDisputeUpdate(update: DisputeGameUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (update.status !== undefined) out.status = update.status;
  if (update.winner !== undefined) out.winner = update.winner;
  if (update.phase !== undefined) out.phase = update.phase;
  if (update.currentSetter !== undefined) out.currentSetter = update.currentSetter;
  if (update.currentTurn !== undefined) out.currentTurn = update.currentTurn;
  if (update.turnDeadlineMs !== undefined) out.turnDeadline = WebTimestamp.fromMillis(update.turnDeadlineMs);
  if (update.turnNumber !== undefined) out.turnNumber = update.turnNumber;
  if (update.p1Letters !== undefined) out.p1Letters = update.p1Letters;
  if (update.p2Letters !== undefined) out.p2Letters = update.p2Letters;
  if (update.matchVideoUrl !== undefined) out.matchVideoUrl = update.matchVideoUrl;
  out.reviewFor = update.reviewFor;
  out.reviewDeadline = update.reviewDeadline;
  if (update.appendTurnRecord !== undefined) out.turnHistory = webArrayUnion(update.appendTurnRecord);
  return out;
}

/** Run a DisputeGameUpdate through both translators. */
function bothWrites(update: DisputeGameUpdate) {
  return { web: toWebDisputeUpdate(update), admin: toAdminDisputeUpdate(update) };
}

describe("toAdminDisputeUpdate / web parity — every verdict branch", () => {
  it("land verdict (honor swap) — identical write incl. Timestamp + arrayUnion", () => {
    const { gameUpdate } = decideDisputeResolution(baseGame(), { landVotes: 2, bailVotes: 1 }, NOW);
    const { web, admin } = bothWrites(gameUpdate);

    expect(admin).toEqual(web);
    expect(admin.updatedAt).toEqual(SERVER_TS);
    expect(admin.phase).toBe("setting");
    expect(admin.currentSetter).toBe("p2");
    expect(admin.turnDeadline).toEqual(ts(NOW + TURN_DURATION_MS));
    expect(admin.turnHistory).toEqual(web.turnHistory);
    expect(admin.reviewFor).toBeNull();
    expect(admin.reviewDeadline).toBeNull();
    expect(Object.keys(admin).sort()).toEqual(Object.keys(web).sort());
  });

  it("zero-vote 'none' auto-accept — identical honor-swap write", () => {
    const { gameUpdate } = decideDisputeResolution(baseGame(), { landVotes: 0, bailVotes: 0 }, NOW);
    const { web, admin } = bothWrites(gameUpdate);
    expect(admin).toEqual(web);
    expect(admin.phase).toBe("setting");
    expect(admin.currentSetter).toBe("p2");
  });

  it("tie/retry — identical write, matchVideoUrl cleared to null, no turnHistory", () => {
    const { gameUpdate } = decideDisputeResolution(baseGame(), { landVotes: 1, bailVotes: 1 }, NOW);
    const { web, admin } = bothWrites(gameUpdate);

    expect(admin).toEqual(web);
    expect(admin.phase).toBe("matching");
    expect(admin.matchVideoUrl).toBeNull();
    expect(admin).not.toHaveProperty("turnHistory");
    expect(admin.turnDeadline).toEqual(ts(NOW + TURN_DURATION_MS));
    expect(Object.keys(admin).sort()).toEqual(Object.keys(web).sort());
  });

  it("bail (matcher < 5) — identical write, letter recorded", () => {
    const { gameUpdate } = decideDisputeResolution(baseGame({ p2Letters: 1 }), { landVotes: 0, bailVotes: 2 }, NOW);
    const { web, admin } = bothWrites(gameUpdate);

    expect(admin).toEqual(web);
    expect(admin.phase).toBe("setting");
    expect(admin.currentSetter).toBe("p1");
    expect(admin.p2Letters).toBe(2);
    expect(admin.turnHistory).toEqual(web.turnHistory);
  });

  it("bail completing the game — identical terminal write, no turn/phase advance", () => {
    const { gameUpdate } = decideDisputeResolution(baseGame({ p2Letters: 4 }), { landVotes: 0, bailVotes: 1 }, NOW);
    const { web, admin } = bothWrites(gameUpdate);

    expect(admin).toEqual(web);
    expect(admin.status).toBe("complete");
    expect(admin.winner).toBe("p1");
    expect(admin).not.toHaveProperty("phase");
    expect(admin).not.toHaveProperty("turnDeadline");
    expect(admin.turnHistory).toEqual(web.turnHistory);
    expect(admin.reviewFor).toBeNull();
    expect(Object.keys(admin).sort()).toEqual(Object.keys(web).sort());
  });

  it("pendingReview auto-accept (deferred honor swap) — identical write", () => {
    const update = decidePendingReviewExpiry(baseGame({ phase: "pendingReview" }), NOW);
    const { web, admin } = bothWrites(update);

    expect(admin).toEqual(web);
    expect(admin.phase).toBe("setting");
    expect(admin.currentSetter).toBe("p2");
    expect(admin.turnDeadline).toEqual(ts(NOW + TURN_DURATION_MS));
    expect(Object.keys(admin).sort()).toEqual(Object.keys(web).sort());
  });

  it("never emits a key the other side omits (no partial drift on any branch)", () => {
    const updates: DisputeGameUpdate[] = [
      decideDisputeResolution(baseGame(), { landVotes: 2, bailVotes: 0 }, NOW).gameUpdate,
      decideDisputeResolution(baseGame(), { landVotes: 0, bailVotes: 0 }, NOW).gameUpdate,
      decideDisputeResolution(baseGame(), { landVotes: 1, bailVotes: 1 }, NOW).gameUpdate,
      decideDisputeResolution(baseGame({ p2Letters: 1 }), { landVotes: 0, bailVotes: 2 }, NOW).gameUpdate,
      decideDisputeResolution(baseGame({ p2Letters: 4 }), { landVotes: 0, bailVotes: 1 }, NOW).gameUpdate,
      decidePendingReviewExpiry(baseGame({ phase: "pendingReview" }), NOW),
    ];
    for (const update of updates) {
      const { web, admin } = bothWrites(update);
      expect(Object.keys(admin).sort()).toEqual(Object.keys(web).sort());
    }
  });
});
