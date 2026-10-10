/**
 * Statement of reasons for a clip decision.
 *
 * A rejection or removal writes moderationStatements/{statementId}. Settings
 * lists that doc and files appeals/statement_{statementId}. The notification
 * opens that screen.
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

/** Settings → Reports & actions, where the statement and its appeal live. */
export const CLIP_APPEAL_PATH = "/settings#safety-reports";

/** Doc id in moderationStatements. Fits the DSA 128-character id cap. */
export function statementIdFor(clipId: string): string {
  const prefixed = `clip_${clipId}`;
  return prefixed.length <= MAX_STATEMENT_ID ? prefixed : clipId.slice(0, MAX_STATEMENT_ID);
}

export function appealPathFor(): string {
  return CLIP_APPEAL_PATH;
}

export function statementForAutoReject(likelihood: string): StatementOfReasons {
  const appealPath = appealPathFor();
  return {
    decision: "rejected",
    grounds: "explicit content",
    statement: `We rejected this clip because automated screening found explicit content (${likelihood}). This decision used automated means. Appeal it in Settings.`,
    appealPath,
    automated: true,
  };
}

export function statementForRemoval(reason: string): StatementOfReasons {
  const appealPath = appealPathFor();
  return {
    decision: "removed",
    grounds: reason,
    statement: `We removed this clip because: ${reason}. Appeal it in Settings.`,
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

export function statementForAutoHide(reasons: readonly string[]): StatementOfReasons {
  const appealPath = appealPathFor();
  const listed = reasons.length > 0 ? reasons.slice(0, 4).join(", ") : "reports from other skaters";
  return {
    decision: "review",
    grounds: "reported by other skaters",
    statement: `We hid this clip because other skaters reported it (${listed}). This decision used automated means. Appeal it in Settings.`,
    appealPath,
    automated: true,
  };
}

export function statementForReview(grounds: string): StatementOfReasons {
  return {
    decision: "review",
    grounds,
    statement: `This clip is in review (${grounds}).`,
    appealPath: appealPathFor(),
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
