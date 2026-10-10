import type { DecisionResult } from "./decide.js";
import {
  statementForApproval,
  statementForAutoReject,
  statementForRemoval,
  statementForReview,
  type StatementOfReasons,
} from "./statement.js";

export type SaveGuard = "pending-only" | "hide-if-open" | "admin";

export interface ClipPatch {
  patch: Record<string, unknown>;
  statement: StatementOfReasons | null;
  guard: SaveGuard;
}

/** Upload decisions only land while the clip is still pending. */
export function shouldApplyUploadDecision(moderation: unknown): boolean {
  return moderation === "pending";
}

/**
 * Community auto-hide applies to public user clips that are still pending
 * or already in the feed. A rejection, a removal, or an open review stands.
 */
export function shouldAutoHideClip(current: { source?: unknown; moderation?: unknown }): boolean {
  if (current.source !== "user") return false;
  const moderation = current.moderation;
  if (moderation === "rejected" || moderation === "removed" || moderation === "review") return false;
  return true;
}

export function uploadPatch(result: DecisionResult): ClipPatch {
  const scores = {
    explicitLikelihood: result.explicitLikelihood,
    skateDetected: result.skateDetected,
    skateLabels: result.skateLabels,
  };
  if (result.decision === "rejected") {
    const statement = statementForAutoReject(result.explicitLikelihood);
    return {
      guard: "pending-only",
      statement,
      patch: {
        moderation: "rejected",
        moderationStatus: "hidden",
        moderationScores: scores,
        moderationNotice: statement,
      },
    };
  }
  if (result.decision === "review") {
    return {
      guard: "pending-only",
      statement: null,
      patch: {
        moderation: "review",
        moderationStatus: "hidden",
        moderationScores: scores,
        moderationNotice: statementForReview(result.grounds),
      },
    };
  }
  return {
    guard: "pending-only",
    statement: null,
    patch: {
      moderation: "approved",
      moderationStatus: "active",
      moderationScores: scores,
    },
  };
}

/** API errors and timeouts never approve. They wait for a person. */
export function failurePatch(message: string): ClipPatch {
  return {
    guard: "pending-only",
    statement: null,
    patch: {
      moderation: "review",
      moderationStatus: "hidden",
      moderationScores: {
        explicitLikelihood: "UNKNOWN",
        skateDetected: false,
        skateLabels: [],
        error: message.slice(0, 200),
      },
    },
  };
}

export function autoHidePatch(reasons: readonly string[]): ClipPatch {
  return {
    guard: "hide-if-open",
    statement: null,
    patch: {
      moderation: "review",
      moderationStatus: "hidden",
      reportReasons: [...reasons],
      moderationNotice: statementForReview("reported by other skaters"),
    },
  };
}

export function adminPatch(decision: "approved" | "removed", reason: string): ClipPatch {
  if (decision === "approved") {
    const statement = statementForApproval();
    return {
      guard: "admin",
      statement,
      patch: {
        moderation: "approved",
        moderationStatus: "active",
        moderationNotice: statement,
      },
    };
  }
  const trimmed = reason.trim().slice(0, 200);
  if (trimmed.length === 0) {
    throw new Error("A reason is required to remove a clip.");
  }
  const statement = statementForRemoval(trimmed);
  return {
    guard: "admin",
    statement,
    patch: {
      moderation: "removed",
      moderationStatus: "hidden",
      moderationNotice: statement,
    },
  };
}
