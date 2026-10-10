import { describe, expect, it } from "vitest";
import {
  clipStoragePath,
  consentSnapshotFromProfile,
  labelPredatesRevocation,
  labelsForTurn,
  revocationMillis,
  trainingLabelId,
  type TrainingConsentSnapshot,
  type TrainingTurn,
} from "../trainingLabels.shared";

const optedIn: TrainingConsentSnapshot = { optedIn: true, policyVersion: "2026-10-10", updatedAtMs: 5 };
const optedOut: TrainingConsentSnapshot = { optedIn: false, policyVersion: null, updatedAtMs: null };

function turn(overrides: Partial<TrainingTurn> = {}): TrainingTurn {
  return {
    turnNumber: 2,
    trickId: "kickflip",
    stance: "switch",
    obstacle: "ledge",
    trickNameCustom: null,
    setterUid: "setter",
    matcherUid: "matcher",
    setVideoUrl: "https://cdn.example/set-setter.webm?alt=media",
    matchVideoUrl: "https://cdn.example/match-matcher.mp4",
    landed: true,
    ...overrides,
  };
}

describe("clip paths", () => {
  it("derives a storage path from the extension and ignores a url without one", () => {
    expect(clipStoragePath("g", 2, "set", "setter", null)).toBeNull();
    expect(clipStoragePath("g", 2, "set", "setter", "https://cdn.example/clip")).toBeNull();
    expect(clipStoragePath("g", 2, "set", "setter", "https://cdn.example/a.WEBM?x=1")).toBe(
      "games/g/turn-2/set-setter.webm",
    );
    expect(trainingLabelId("g", 2, "match")).toBe("g_2_match");
  });
});

describe("labelsForTurn", () => {
  it("skips free-text turns and clips with no path", () => {
    const consent = () => optedIn;
    expect(labelsForTurn("g", turn({ trickId: undefined }), {}, consent)).toEqual([]);
    expect(labelsForTurn("g", turn({ trickId: "" }), {}, consent)).toEqual([]);
    expect(labelsForTurn("g", turn({ turnNumber: "1" as unknown as number }), {}, consent)).toEqual([]);
    expect(labelsForTurn("g", turn({ matcherUid: "", matchVideoUrl: null, setVideoUrl: "nope" }), {}, consent)).toEqual(
      [],
    );
  });

  it("writes a set and a match label and defaults missing stance", () => {
    const labels = labelsForTurn(
      "g",
      turn({ stance: undefined, obstacle: undefined, trickNameCustom: undefined }),
      {},
      () => optedIn,
    );
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatchObject({
      role: "set",
      outcome: "landed",
      via: "play",
      stance: "regular",
      obstacle: null,
      trickNameCustom: null,
      excluded: false,
      clipPath: "games/g/turn-2/set-setter.webm",
    });
    expect(labels[1]).toMatchObject({ role: "match", outcome: "landed", via: "play" });
  });

  it("records a miss, a judge, a dispute, and a forfeit on the last turn only", () => {
    const consent = (uid: string) => (uid === "setter" ? optedIn : optedOut);
    const missed = labelsForTurn("g", turn({ landed: false }), {}, consent);
    expect(missed.map((label) => label.outcome)).toEqual(["landed", "missed"]);
    expect(missed[1]?.excluded).toBe(true);

    const judged = labelsForTurn("g", turn({ judgedBy: "ref", landed: false }), {}, () => optedIn);
    expect(judged.map((label) => label.outcome)).toEqual(["judge_landed", "judge_missed"]);
    expect(judged[0]?.via).toBe("judge");
    const judgedLanded = labelsForTurn("g", turn({ judgedBy: "ref", landed: true }), {}, () => optedIn);
    expect(judgedLanded[1]?.outcome).toBe("judge_landed");

    const disputed = labelsForTurn("g", turn({ landed: false }), { lastResolvedDisputeTurnNumber: 2 }, () => optedIn);
    expect(disputed.map((label) => [label.role, label.outcome])).toEqual([
      ["set", "dispute_missed"],
      ["match", "dispute_missed"],
    ]);
    const disputeLanded = labelsForTurn(
      "g",
      turn({ landed: true }),
      { lastResolvedDisputeTurnNumber: 2 },
      () => optedIn,
    );
    expect(disputeLanded[0]?.outcome).toBe("dispute_landed");
    expect(disputeLanded[1]?.outcome).toBe("dispute_landed");

    const earlier = labelsForTurn("g", turn({ turnNumber: 1 }), { status: "forfeit" }, () => optedIn, false);
    expect(earlier[0]?.via).toBe("play");
    const last = labelsForTurn("g", turn(), { status: "forfeit" }, () => optedIn, true);
    expect(last.map((label) => label.outcome)).toEqual(["forfeit", "forfeit"]);

    expect(
      labelsForTurn("g", turn({ judgedBy: "" }), { lastResolvedDisputeTurnNumber: 9 }, () => optedIn)[0]?.via,
    ).toBe("play");
  });
});

describe("consent and revocation helpers", () => {
  it("reads a consent snapshot and treats junk as opted out", () => {
    expect(consentSnapshotFromProfile(null)).toEqual(optedOut);
    expect(consentSnapshotFromProfile(undefined)).toEqual(optedOut);
    expect(
      consentSnapshotFromProfile({
        trainingConsentOptedIn: true,
        trainingConsentPolicyVersion: "2026-10-10",
        trainingConsentUpdatedAt: 12,
      }),
    ).toEqual({ optedIn: true, policyVersion: "2026-10-10", updatedAtMs: 12 });
    expect(
      consentSnapshotFromProfile({
        trainingConsentOptedIn: "yes",
        trainingConsentPolicyVersion: 1,
        trainingConsentUpdatedAt: new Date(50),
      }),
    ).toEqual({ optedIn: false, policyVersion: null, updatedAtMs: 50 });
    expect(consentSnapshotFromProfile({ trainingConsentUpdatedAt: { toMillis: () => 7 } }).updatedAtMs).toBe(7);
    expect(consentSnapshotFromProfile({ trainingConsentUpdatedAt: { toMillis: () => "nope" } }).updatedAtMs).toBeNull();
    expect(consentSnapshotFromProfile({ trainingConsentUpdatedAt: { toMillis: "nope" } }).updatedAtMs).toBeNull();
    expect(consentSnapshotFromProfile({ trainingConsentUpdatedAt: { nope: true } }).updatedAtMs).toBeNull();
  });

  it("treats a missing createdAt as older than the withdrawal", () => {
    expect(labelPredatesRevocation(null, 10)).toBe(true);
    expect(labelPredatesRevocation(10, 10)).toBe(true);
    expect(labelPredatesRevocation(11, 10)).toBe(false);
    expect(revocationMillis(null)).toBeNull();
    expect(revocationMillis({ revokedAt: 4 })).toBe(4);
    expect(revocationMillis({})).toBeNull();
  });
});
