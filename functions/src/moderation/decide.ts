import {
  LIKELIHOOD_RANK,
  MIN_SKATE_CONFIDENCE,
  REJECT_MIN_RANK,
  REVIEW_MIN_RANK,
  SKATE_LABELS,
  type LikelihoodName,
} from "./config.js";

export interface LabelHit {
  description: string;
  confidence: number;
}

export interface VideoAnnotation {
  explicitLikelihoods: string[];
  labels: LabelHit[];
}

export type ModerationDecision = "approved" | "review" | "rejected";

export interface DecisionResult {
  decision: ModerationDecision;
  explicitLikelihood: string;
  skateDetected: boolean;
  skateLabels: string[];
  grounds: string;
}

export function rankLikelihood(name: string): number {
  if (Object.hasOwn(LIKELIHOOD_RANK, name)) {
    return LIKELIHOOD_RANK[name as LikelihoodName];
  }
  return LIKELIHOOD_RANK.UNKNOWN;
}

/** Highest explicit-content likelihood in the frame list, or UNKNOWN. */
export function maxLikelihood(names: readonly string[]): string {
  let best = "UNKNOWN";
  let bestRank = 0;
  for (const name of names) {
    const rank = rankLikelihood(name);
    if (rank > bestRank) {
      best = name;
      bestRank = rank;
    }
  }
  return best;
}

function isSkateLabel(description: string): boolean {
  const normalized = description.trim().toLowerCase();
  return SKATE_LABELS.some((label) => normalized === label || normalized.includes(label));
}

/**
 * Turn an annotation into a moderation outcome.
 *
 * Clearly explicit (LIKELY / VERY_LIKELY) is rejected. Borderline explicit
 * (POSSIBLE), or no confident skateboard / skateboarding label, goes to
 * review. Anything else is approved.
 */
export function decideFromAnnotation(annotation: VideoAnnotation): DecisionResult {
  const explicitLikelihood = maxLikelihood(annotation.explicitLikelihoods);
  const explicitRank = rankLikelihood(explicitLikelihood);
  const skateLabels = annotation.labels
    .filter((label) => isSkateLabel(label.description) && label.confidence >= MIN_SKATE_CONFIDENCE)
    .map((label) => label.description);
  const skateDetected = skateLabels.length > 0;

  if (explicitRank >= REJECT_MIN_RANK) {
    return {
      decision: "rejected",
      explicitLikelihood,
      skateDetected,
      skateLabels,
      grounds: "explicit content",
    };
  }
  if (explicitRank >= REVIEW_MIN_RANK) {
    return {
      decision: "review",
      explicitLikelihood,
      skateDetected,
      skateLabels,
      grounds: "possible explicit content",
    };
  }
  if (!skateDetected) {
    return {
      decision: "review",
      explicitLikelihood,
      skateDetected: false,
      skateLabels: [],
      grounds: "no skateboard detected",
    };
  }
  return {
    decision: "approved",
    explicitLikelihood,
    skateDetected: true,
    skateLabels,
    grounds: "skateboarding",
  };
}
