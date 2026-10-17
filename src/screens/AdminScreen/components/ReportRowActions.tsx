import { useId, useState } from "react";
import type { AdminReport } from "../../../services/admin";
import { ConfirmButton } from "./ConfirmButton";

export interface ReportRowActionsProps {
  report: AdminReport;
  acting: boolean;
  onResolve: (report: AdminReport, explanation: string) => void;
  onDismiss: (report: AdminReport) => void;
  onBan: (report: AdminReport) => void;
  onHideDispute: (report: AdminReport) => void;
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
export function ReportRowActions({
  report,
  acting,
  onResolve,
  onDismiss,
  onBan,
  onHideDispute,
}: ReportRowActionsProps) {
  const [drafting, setDrafting] = useState(false);
  const [explanation, setExplanation] = useState("");
  const statementId = useId();
  if (report.status !== "pending") return null;

  const statementReady = explanation.trim().length > 0;

  return (
    <>
      <div className="mt-3 flex gap-2">
        {drafting ? (
          <div className="flex-1">
            <label htmlFor={statementId} className="block font-display text-[11px] tracking-[0.12em] text-dim mb-2">
              STATEMENT OF REASONS
            </label>
            <textarea
              id={statementId}
              value={explanation}
              onChange={(event) => setExplanation(event.target.value)}
              maxLength={1000}
              rows={3}
              disabled={acting}
              className="w-full bg-surface-alt/80 border border-border rounded-2xl text-white text-sm font-body outline-none px-3 py-2.5 focus:border-brand-orange disabled:opacity-40 resize-none"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onResolve(report, explanation.trim())}
                disabled={acting || !statementReady}
                className={`${VERDICT_BTN} border-brand-green/40 bg-brand-green/[0.1] text-brand-green`}
              >
                {acting ? "..." : "Confirm resolve"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrafting(false);
                  setExplanation("");
                }}
                disabled={acting}
                className={`${VERDICT_BTN} border-border text-muted hover:text-white`}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setDrafting(true)}
            disabled={acting}
            className={`${VERDICT_BTN} border-brand-green/40 bg-brand-green/[0.1] text-brand-green`}
          >
            {acting ? "..." : "RESOLVE"}
          </button>
        )}
        <button
          type="button"
          onClick={() => onDismiss(report)}
          disabled={acting}
          className={`${VERDICT_BTN} border-border text-muted hover:text-white`}
        >
          {acting ? "..." : "DISMISS"}
        </button>
      </div>
      <div className="mt-2 flex flex-col gap-2">
        {report.disputeId && (
          <ConfirmButton
            label="Hide dispute"
            question={`Hide dispute ${report.disputeId} from the feed?`}
            confirmLabel="Hide"
            tone="danger"
            loading={acting}
            onConfirm={() => onHideDispute(report)}
          />
        )}
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
