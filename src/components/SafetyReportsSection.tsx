import { useEffect, useId, useState } from "react";
import {
  getMyBan,
  listMyAppeals,
  listMyReports,
  listMyStatements,
  submitAppeal,
  type AccountRestriction,
  type AppealTargetKind,
  type ModerationStatement,
  type MyAppeal,
  type MyReport,
} from "../services/moderation";
import { REPORT_REASON_LABELS, type ReportReason } from "../services/reports";
import { Btn } from "./ui/Btn";
import { ErrorBanner } from "./ui/ErrorBanner";

interface ReadyState {
  reports: MyReport[];
  statements: ModerationStatement[];
  ban: AccountRestriction | null;
  appeals: MyAppeal[];
}

interface AppealDraft {
  kind: AppealTargetKind;
  targetId: string;
}

function reasonLabel(reason: string): string {
  return Object.hasOwn(REPORT_REASON_LABELS, reason) ? REPORT_REASON_LABELS[reason as ReportReason] : reason;
}

function reportStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Received — in review";
    case "resolved":
      return "Action taken";
    case "dismissed":
      return "No action taken";
    default:
      return status;
  }
}

function appealStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Appeal received";
    case "upheld":
      return "Appeal upheld";
    case "rejected":
      return "Appeal rejected";
    default:
      return status;
  }
}

function appealFor(appeals: MyAppeal[], kind: AppealTargetKind, targetId: string): MyAppeal | undefined {
  return appeals.find((appeal) => appeal.targetKind === kind && appeal.targetId === targetId);
}

/**
 * Settings surface for DSA notice-and-action: reports the user filed, statements
 * of reasons on content that was restricted, an account ban, and an appeal.
 */
export function SafetyReportsSection({ uid }: { uid: string }) {
  const [reloadKey, setReloadKey] = useState(0);
  return <SafetyReportsBody key={`${uid}:${reloadKey}`} uid={uid} onReload={() => setReloadKey((key) => key + 1)} />;
}

function SafetyReportsBody({ uid, onReload }: { uid: string; onReload: () => void }) {
  const [state, setState] = useState<ReadyState | null>(null);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<AppealDraft | null>(null);
  const [explanation, setExplanation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const explanationId = useId();

  useEffect(() => {
    let cancelled = false;
    Promise.all([listMyReports(uid), listMyStatements(uid), getMyBan(uid), listMyAppeals(uid)])
      .then(([reports, statements, ban, appeals]) => {
        if (!cancelled) setState({ reports, statements, ban, appeals });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [uid]);

  const sendAppeal = async (): Promise<void> => {
    if (!draft || explanation.trim().length === 0) return;
    setSubmitting(true);
    setFormError("");
    try {
      await submitAppeal(uid, draft.kind, draft.targetId, explanation);
      onReload();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Failed to submit appeal");
      setSubmitting(false);
    }
  };

  if (failed) {
    return (
      <p data-testid="safety-reports-error" role="alert" className="font-body text-sm text-brand-red">
        Couldn&apos;t load your reports.
      </p>
    );
  }

  if (!state) {
    return (
      <p data-testid="safety-reports-loading" aria-busy="true" className="font-body text-sm text-muted">
        Loading your reports...
      </p>
    );
  }

  return (
    <div data-testid="safety-reports" className="space-y-3">
      <div className="p-4 rounded-2xl glass-card">
        <p className="font-display text-sm text-white tracking-wide">My reports</p>
        {state.reports.length === 0 ? (
          <p className="font-body text-xs text-faint mt-2">You haven&apos;t filed a report.</p>
        ) : (
          <ul className="mt-3 space-y-3" data-testid="my-reports-list">
            {state.reports.map((report) => (
              <li key={report.id} data-testid={`my-report-${report.id}`}>
                <p className="font-body text-sm text-white">{reasonLabel(report.reason)}</p>
                <p className="font-body text-xs text-muted mt-0.5">{reportStatusLabel(report.status)}</p>
                <p className="font-body text-xs text-faint mt-0.5">Reference {report.id}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="p-4 rounded-2xl glass-card">
        <p className="font-display text-sm text-white tracking-wide">Statements of reasons</p>
        {state.statements.length === 0 && !state.ban ? (
          <p className="font-body text-xs text-faint mt-2">No action has been taken on your content.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {state.statements.map((statement) => (
              <li key={statement.id} data-testid={`statement-${statement.id}`}>
                <p className="font-body text-xs text-muted">{reasonLabel(statement.reason)}</p>
                <p className="font-body text-sm text-white mt-1">{statement.explanation}</p>
                <AppealControl
                  appeals={state.appeals}
                  kind="statement"
                  targetId={statement.id}
                  onAppeal={() => {
                    setDraft({ kind: "statement", targetId: statement.id });
                    setExplanation("");
                    setFormError("");
                  }}
                />
              </li>
            ))}
            {state.ban && (
              <li data-testid="account-restriction">
                <p className="font-body text-sm text-white">Your account is restricted.</p>
                <p className="font-body text-xs text-muted mt-1">
                  {state.ban.reason.trim().length > 0
                    ? state.ban.reason
                    : "We restricted your account. A written reason was not included."}
                </p>
                <AppealControl
                  appeals={state.appeals}
                  kind="ban"
                  targetId={uid}
                  onAppeal={() => {
                    setDraft({ kind: "ban", targetId: uid });
                    setExplanation("");
                    setFormError("");
                  }}
                />
              </li>
            )}
          </ul>
        )}
      </div>

      {draft && (
        <div className="p-4 rounded-2xl glass-card">
          <label htmlFor={explanationId} className="block font-display text-sm tracking-[0.12em] text-dim mb-2">
            WHY SHOULD THIS BE REVIEWED?
          </label>
          <textarea
            id={explanationId}
            value={explanation}
            onChange={(event) => setExplanation(event.target.value)}
            maxLength={1000}
            rows={3}
            disabled={submitting}
            className="w-full bg-surface-alt/80 border border-border rounded-2xl text-white text-base font-body outline-none px-4 py-3.5 focus:border-brand-orange disabled:opacity-40 resize-none"
          />
          {formError && <ErrorBanner message={formError} onDismiss={() => setFormError("")} />}
          <div className="flex gap-3 mt-3">
            <Btn
              variant="secondary"
              disabled={submitting}
              onClick={() => {
                setDraft(null);
                setFormError("");
              }}
            >
              Cancel
            </Btn>
            <Btn
              variant="primary"
              disabled={submitting || explanation.trim().length === 0}
              onClick={() => void sendAppeal()}
            >
              {submitting ? "Sending..." : "Submit appeal"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

function AppealControl({
  appeals,
  kind,
  targetId,
  onAppeal,
}: {
  appeals: MyAppeal[];
  kind: AppealTargetKind;
  targetId: string;
  onAppeal: () => void;
}) {
  const existing = appealFor(appeals, kind, targetId);
  if (existing) {
    return <p className="font-body text-xs text-muted mt-2">{appealStatusLabel(existing.status)}</p>;
  }
  return (
    <button
      type="button"
      onClick={onAppeal}
      className="mt-2 inline-flex min-h-[44px] items-center font-display text-[11px] tracking-[0.15em] text-brand-orange focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
    >
      Appeal
    </button>
  );
}
