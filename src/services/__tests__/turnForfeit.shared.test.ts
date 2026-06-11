import { describe, it, expect } from "vitest";

import { decideExpiredForfeit } from "../turnForfeit.shared";
import { TURN_DURATION_MS } from "../turnDuration";
import type { GameDoc } from "../games.mappers";

const NOW = 1_700_000_000_000;

/** Minimal Timestamp-like stub: only `toMillis` is read by the helper. */
function deadline(ms: number): GameDoc["turnDeadline"] {
  return { toMillis: () => ms } as unknown as GameDoc["turnDeadline"];
}

function baseGame(overrides: Partial<GameDoc> = {}): GameDoc {
  return {
    id: "g1",
    player1Uid: "p1",
    player2Uid: "p2",
    player1Username: "alice",
    player2Username: "bob",
    p1Letters: 0,
    p2Letters: 0,
    status: "active",
    currentTurn: "p1",
    phase: "setting",
    currentSetter: "p1",
    currentTrickName: null,
    currentTrickVideoUrl: null,
    matchVideoUrl: null,
    turnDeadline: deadline(NOW - 1),
    turnNumber: 1,
    winner: null,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

describe("decideExpiredForfeit", () => {
  it("returns null when the deadline has not passed", () => {
    const game = baseGame({ turnDeadline: deadline(NOW + 1) });
    expect(decideExpiredForfeit(game, NOW, "g1")).toBeNull();
  });

  it("returns null when no deadline is set (toMillis missing)", () => {
    const game = baseGame({ turnDeadline: undefined as unknown as GameDoc["turnDeadline"] });
    expect(decideExpiredForfeit(game, NOW, "g1")).toBeNull();
  });

  it("returns null when deadline resolves to 0", () => {
    const game = baseGame({ turnDeadline: deadline(0) });
    expect(decideExpiredForfeit(game, NOW, "g1")).toBeNull();
  });

  it("returns null when the game is already resolved (idempotent)", () => {
    expect(decideExpiredForfeit(baseGame({ status: "forfeit" }), NOW, "g1")).toBeNull();
    expect(decideExpiredForfeit(baseGame({ status: "complete" }), NOW, "g1")).toBeNull();
  });

  it("decides a plain forfeit when a setting/matching turn expires", () => {
    const game = baseGame({
      currentTurn: "p1",
      currentSetter: "p1",
      currentTrickName: "Kickflip",
      currentTrickVideoUrl: "https://vid/set.webm",
    });

    const decision = decideExpiredForfeit(game, NOW, "g1");
    expect(decision).not.toBeNull();
    expect(decision!.kind).toBe("forfeit");
    expect(decision!.winnerUid).toBe("p2");
    expect(decision!.loserUid).toBe("p1");
    expect(decision!.gameUpdate.status).toBe("forfeit");
    expect(decision!.gameUpdate.winner).toBe("p2");
    expect(decision!.landedClips).toBeNull();

    const record = decision!.gameUpdate.appendTurnRecord!;
    expect(record.landed).toBe(false);
    expect(record.letterTo).toBe("p1");
    expect(record.trickName).toBe("Kickflip");
    expect(record.setterUid).toBe("p1");
    expect(record.matcherUid).toBe("p2");
  });

  it("awards the win to p1 when p2's turn expires (covers username ternary)", () => {
    const game = baseGame({ currentTurn: "p2", currentSetter: "p2" });

    const decision = decideExpiredForfeit(game, NOW, "g1");
    expect(decision!.winnerUid).toBe("p1");
    expect(decision!.loserUid).toBe("p2");
    const record = decision!.gameUpdate.appendTurnRecord!;
    expect(record.setterUsername).toBe("bob");
    expect(record.matcherUsername).toBe("alice");
  });

  it("uses the 'Trick' fallback when the forfeited turn has no trick name", () => {
    const decision = decideExpiredForfeit(baseGame({ currentTrickName: null }), NOW, "g1");
    expect(decision!.gameUpdate.appendTurnRecord!.trickName).toBe("Trick");
  });

  it("auto-accepts an expired disputable phase (matcher's landed call stands)", () => {
    const game = baseGame({
      phase: "disputable",
      currentSetter: "p1",
      currentTurn: "p1",
      currentTrickName: "Heelflip",
      currentTrickVideoUrl: "https://vid/set.webm",
      matchVideoUrl: "https://vid/match.webm",
      spotId: "spot-1",
    });

    const decision = decideExpiredForfeit(game, NOW, "g1");
    expect(decision!.kind).toBe("disputeAccept");
    expect(decision!.winnerUid).toBeNull();
    expect(decision!.loserUid).toBeNull();

    const u = decision!.gameUpdate;
    expect(u.phase).toBe("setting");
    expect(u.currentSetter).toBe("p2"); // roles swap
    expect(u.currentTurn).toBe("p2");
    expect(u.turnNumber).toBe(2);
    expect(u.turnDeadlineMs).toBe(NOW + TURN_DURATION_MS);
    expect(u.p1Letters).toBe(0);
    expect(u.p2Letters).toBe(0);
    expect(u.judgeReviewFor).toBeNull();
    expect(u.appendTurnRecord!.landed).toBe(true);
    expect(u.appendTurnRecord!.letterTo).toBeNull();

    const clips = decision!.landedClips!;
    expect(clips.matcherLanded).toBe(true);
    expect(clips.setterUid).toBe("p1");
    expect(clips.matcherUid).toBe("p2");
    expect(clips.trickName).toBe("Heelflip");
    expect(clips.spotId).toBe("spot-1");
  });

  it("disputable: falls back to 'Trick' and null spotId when fields absent", () => {
    const game = baseGame({
      phase: "disputable",
      currentSetter: "p2",
      currentTurn: "p2",
      currentTrickName: null,
      currentTrickVideoUrl: null,
      matchVideoUrl: null,
    });

    const decision = decideExpiredForfeit(game, NOW, "g1");
    expect(decision!.gameUpdate.currentSetter).toBe("p1"); // matcher becomes setter
    expect(decision!.gameUpdate.appendTurnRecord!.trickName).toBe("Trick");
    expect(decision!.gameUpdate.appendTurnRecord!.setterUsername).toBe("bob"); // p2 setter
    expect(decision!.gameUpdate.appendTurnRecord!.matcherUsername).toBe("alice");
    expect(decision!.landedClips!.spotId).toBeNull();
  });

  it("auto-clears an expired setReview (benefit of the doubt to setter)", () => {
    const game = baseGame({
      phase: "setReview",
      currentSetter: "p1",
      currentTurn: "j1",
      judgeId: "j1",
      judgeStatus: "accepted",
    });

    const decision = decideExpiredForfeit(game, NOW, "g1");
    expect(decision!.kind).toBe("setReviewClear");
    expect(decision!.winnerUid).toBeNull();
    expect(decision!.landedClips).toBeNull();

    const u = decision!.gameUpdate;
    expect(u.phase).toBe("matching");
    expect(u.currentTurn).toBe("p2"); // matcher (opponent of setter)
    expect(u.judgeReviewFor).toBeNull();
    expect(u.turnDeadlineMs).toBe(NOW + TURN_DURATION_MS);
  });
});
