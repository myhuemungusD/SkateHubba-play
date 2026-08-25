import type { AdminReport } from "../../../services/admin";
import { ConfirmButton } from "./ConfirmButton";

export interface ReportRowActionsProps {
  report: AdminReport;
  acting: boolean;
  onResolve: (report: AdminReport) => void;
  onDismiss: (report: AdminReport) => void;
  onBan: (report: AdminReport) => void;
}

const VERDICT_BTN =
  "inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border px-3 font-display text-[11px] tracking-[0.15em] transition-colors active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40";

/**
 * Verdict + enforcement controls for one pending report.
 *
 * Verdict controls are pending-only: firestore.rules gates the report update
 * on `resource.data.status == 'pending'`, so offering them on an
 * already-closed report would hand the operator a guaranteed
 * permission-denied.
 *
 * BAN is separated from the verdict row and gated behind a confirm step, for
 * two reasons. It is the only irreversible-feeling action on the screen, and
 * it is a different KIND of action: resolving a report closes a ticket, while
 * banning acts on a person and outlives the ticket entirely. Banning does not
 * itself resolve the report — the operator still records a verdict, so the
 * audit trail shows both what was decided and what was done.
 */
export function ReportRowActions({ report, acting, onResolve, onDismiss, onBan }: ReportRowActionsProps) {
  if (report.status !== "pending") return null;

  return (
    <>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => onResolve(report)}
          disabled={acting}
          className={`${VERDICT_BTN} border-brand-green/40 bg-brand-green/[0.1] text-brand-green`}
        >
          {acting ? "..." : "RESOLVE"}
        </button>
        <button
          type="button"
          onClick={() => onDismiss(report)}
          disabled={acting}
          className={`${VERDICT_BTN} border-border text-muted hover:text-white`}
        >
          {acting ? "..." : "DISMISS"}
        </button>
      </div>
      <div className="mt-2">
        <ConfirmButton
          label="Ban user"
          question={`Ban @${report.reportedUsername}?`}
          confirmLabel="Ban"
          tone="danger"
          loading={acting}
          onConfirm={() => onBan(report)}
        />
      </div>
    </>
  );
}
