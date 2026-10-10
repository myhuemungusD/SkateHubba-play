/**
 * Statement of reasons for a clip decision.
 *
 * The appeal link opens /appeal/:statementId. The function also writes
 * moderationStatements/{statementId} and the owner files appeals/statement_{id},
 * the same collections as the open DSA PR (#642). That PR had not merged
 * on 2026-10-10, so this does not depend on its code.
 */
export interface StatementOfReasons {
  decision: "rejected" | "removed" | "approved" | "review";
  grounds: string;
  statement: string;
  appealPath: string;
  /** True when Video Intelligence made the call without a person. */
  automated: boolean;
}

const MAX_BODY = 200;
const MAX_STATEMENT_ID = 128;

/** Doc id in moderationStatements. Fits the DSA 128-character id cap. */
export function statementIdFor(clipId: string): string {
  const prefixed = `clip_${clipId}`;
  return prefixed.length <= MAX_STATEMENT_ID ? prefixed : clipId.slice(0, MAX_STATEMENT_ID);
}

export function appealPathFor(clipId: string): string {
  return `/appeal/${encodeURIComponent(statementIdFor(clipId))}`;
}

export function statementForAutoReject(clipId: string, likelihood: string): StatementOfReasons {
  const appealPath = appealPathFor(clipId);
  return {
    decision: "rejected",
    grounds: "explicit content",
    statement: `We rejected this clip because automated screening found explicit content (${likelihood}). This decision used automated means. You can appeal at ${appealPath}.`,
    appealPath,
    automated: true,
  };
}

export function statementForRemoval(clipId: string, reason: string): StatementOfReasons {
  const appealPath = appealPathFor(clipId);
  return {
    decision: "removed",
    grounds: reason,
    statement: `We removed this clip because: ${reason}. You can appeal at ${appealPath}.`,
    appealPath,
    automated: false,
  };
}

export function statementForApproval(): StatementOfReasons {
  return {
    decision: "approved",
    grounds: "kept by a moderator",
    statement: "Your clip passed review and is in the feed.",
    appealPath: "",
    automated: false,
  };
}

export function statementForReview(clipId: string, grounds: string): StatementOfReasons {
  return {
    decision: "review",
    grounds,
    statement: `This clip is in review (${grounds}).`,
    appealPath: appealPathFor(clipId),
    automated: true,
  };
}

export function notificationCopy(statement: StatementOfReasons): { title: string; body: string } {
  const title = titleFor(statement.decision);
  const body = statement.statement.length > MAX_BODY ? statement.statement.slice(0, MAX_BODY) : statement.statement;
  return { title, body };
}

function titleFor(decision: StatementOfReasons["decision"]): string {
  switch (decision) {
    case "rejected":
      return "Clip rejected";
    case "removed":
      return "Clip removed";
    case "approved":
      return "Clip is live";
    case "review":
      return "Clip in review";
    default: {
      const neverDecision: never = decision;
      return neverDecision;
    }
  }
}
