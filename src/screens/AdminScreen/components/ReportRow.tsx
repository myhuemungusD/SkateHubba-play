import type { AdminReport } from "../../../services/admin";
import { REPORT_REASON_LABELS, type ReportReason } from "../../../services/reports";
import { relativeAge } from "../utils";
import { ReportRowActions } from "./ReportRowActions";

/**
 * Reason labels are keyed by the reasons this build knows about. A report
 * written by a newer client can carry one it doesn't, so the raw value is
 * shown rather than a blank cell — moderation must never silently lose the
 * only field describing what was reported.
 */
function reasonLabel(reason: string): string {
  return Object.hasOwn(REPORT_REASON_LABELS, reason) ? REPORT_REASON_LABELS[reason as ReportReason] : reason;
}

export interface ReportRowProps {
  report: AdminReport;
  /** True while any action on THIS report is in flight. */
  acting: boolean;
  onResolve: (report: AdminReport) => void;
  onDismiss: (report: AdminReport) => void;
  onBan: (report: AdminReport) => void;
}

/**
 * One row of the moderation queue.
 *
 * Extracted from ReportsPanel, which was at the top of its 250 LOC budget
 * before the ban action needed to go in. Deliberately still read-and-verdict
 * only: the reported player, game and reporter are plain text, not links —
 * navigating away mid-triage would lose the queue.
 */
export function ReportRow({ report, acting, onResolve, onDismiss, onBan }: ReportRowProps) {
  return (
    <li data-testid={`report-${report.id}`} className="rounded-2xl border border-border bg-surface p-3">
      <p className="font-display text-sm text-white">@{report.reportedUsername}</p>
      <p className="mt-0.5 font-body text-xs text-muted">{reasonLabel(report.reason)}</p>

      {/* The reporter's own words — the evidence the verdict is being made on.
          Rendered as a plain text node so React escapes it: this is untrusted
          user input and must never reach innerHTML. `whitespace-pre-wrap`
          keeps the reporter's line breaks, and a capped scroll box (the app's
          existing overflow idiom) stops a 500-char wall of text pushing the
          verdict buttons off screen. */}
      {report.description ? (
        <p
          data-testid={`report-description-${report.id}`}
          className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-border bg-surface-alt/60 p-2 font-body text-xs leading-relaxed break-words whitespace-pre-wrap text-white/90"
        >
          {report.description}
        </p>
      ) : (
        <p className="mt-2 font-body text-xs text-faint italic">No description provided</p>
      )}

      {report.clipId && (
        <p data-testid={`report-clip-${report.id}`} className="mt-2 font-mono text-[11px] break-all text-subtle">
          clip {report.clipId}
        </p>
      )}

      {/* Provenance line. A clip a skater posted directly has no game, so the
          row says "feed clip" instead of "game null" — an operator reading a
          literal null has to go and find out whether it means "no game" or
          "we lost the field". */}
      <p className="mt-1 font-body text-[11px] break-all text-faint">
        {relativeAge(report.createdAt)} · {report.gameId ? `game ${report.gameId}` : "feed clip (no game)"} · reporter{" "}
        {report.reporterUid}
      </p>

      {/* Resolution audit trail. Only a report that already carries a verdict
          has one; reports resolved before the audit fields shipped render
          "unknown" rather than being hidden, so the verdict itself is never
          silently dropped from the row. */}
      {report.status !== "pending" && (
        <p data-testid={`report-resolution-${report.id}`} className="mt-1 font-body text-[11px] break-all text-faint">
          {report.status} by {report.resolvedBy || "unknown"} · {relativeAge(report.resolvedAt)}
        </p>
      )}

      <ReportRowActions report={report} acting={acting} onResolve={onResolve} onDismiss={onDismiss} onBan={onBan} />
    </li>
  );
}
