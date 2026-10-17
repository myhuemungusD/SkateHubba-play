import { describe, expect, it } from "vitest";
import { decideFromAnnotation, maxLikelihood, rankLikelihood } from "./decide.js";

const skate = { description: "skateboarding", confidence: 0.91 };

describe("rankLikelihood", () => {
  it("ranks the API names and treats anything else as unknown", () => {
    expect(rankLikelihood("VERY_LIKELY")).toBeGreaterThan(rankLikelihood("LIKELY"));
    expect(rankLikelihood("LIKELY")).toBeGreaterThan(rankLikelihood("POSSIBLE"));
    expect(rankLikelihood("not-a-level")).toBe(0);
  });
});

describe("maxLikelihood", () => {
  it("picks the strongest frame and ignores an empty list", () => {
    expect(maxLikelihood(["VERY_UNLIKELY", "POSSIBLE", "UNLIKELY"])).toBe("POSSIBLE");
    expect(maxLikelihood([])).toBe("UNKNOWN");
  });
});

describe("decideFromAnnotation", () => {
  it("rejects a clearly explicit clip", () => {
    const result = decideFromAnnotation({
      explicitLikelihoods: ["UNLIKELY", "VERY_LIKELY"],
      labels: [skate],
    });
    expect(result.decision).toBe("rejected");
    expect(result.grounds).toBe("explicit content");
    expect(result.explicitLikelihood).toBe("VERY_LIKELY");
  });

  it("sends a borderline explicit clip to review", () => {
    const result = decideFromAnnotation({
      explicitLikelihoods: ["POSSIBLE"],
      labels: [skate],
    });
    expect(result.decision).toBe("review");
    expect(result.grounds).toBe("possible explicit content");
  });

  it("sends a clip with no confident skate label to review", () => {
    const weak = decideFromAnnotation({
      explicitLikelihoods: ["UNLIKELY"],
      labels: [{ description: "skateboard", confidence: 0.2 }],
    });
    expect(weak.decision).toBe("review");
    expect(weak.grounds).toBe("no skateboard detected");

    const other = decideFromAnnotation({
      explicitLikelihoods: ["VERY_UNLIKELY"],
      labels: [{ description: "dog", confidence: 0.99 }],
    });
    expect(other.decision).toBe("review");
  });

  it("approves a non-explicit clip that shows a skateboard", () => {
    const result = decideFromAnnotation({
      explicitLikelihoods: ["VERY_UNLIKELY", "UNLIKELY"],
      labels: [
        { description: "Skateboard", confidence: 0.8 },
        { description: "person", confidence: 0.4 },
      ],
    });
    expect(result).toMatchObject({
      decision: "approved",
      skateDetected: true,
      grounds: "skateboarding",
    });
    expect(result.skateLabels).toEqual(["Skateboard"]);
  });
});
