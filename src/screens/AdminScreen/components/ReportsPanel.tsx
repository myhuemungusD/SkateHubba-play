import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchReports, resolveReport, type AdminReport } from "../../../services/admin";
import { REPORT_REASON_LABELS, type ReportReason } from "../../../services/reports";
import { useNotifications } from "../../../context/NotificationContext";
import { errorMessage, relativeAge } from "../utils";

type Verdict = "resolved" | "dismissed";

/**
 * Queue views. `pending` is the triage queue; `resolved` is the read-only
 * audit trail. "dismissed" reports are deliberately not a third tab yet —
 * one toggle keeps the header inside its layout, and the resolved view is
 * what the audit line was added for.
 */
const VIEWS = [
  { status: "pending", label: "PENDING" },
  { status: "resolved", label: "RESOLVED" },
] as const;

type ViewStatus = (typeof VIEWS)[number]["status"];

/**
 * Reason labels are keyed by the reasons this build knows about. A report
 * written by a newer client can carry one it doesn't, so the raw value is
 * shown rather than a blank cell — moderation must never silently lose the
 * only field describing what was reported.
 */
function reasonLabel(reason: string): string {
  return Object.hasOwn(REPORT_REASON_LABELS, reason) ? REPORT_REASON_LABELS[reason as ReportReason] : reason;
}

/**
 * Pending report queue.
 *
 * v1 is deliberately read-and-verdict only: the reported player, game and
 * reporter are plain text, not links. Navigating away mid-triage would lose
 * the queue, and the ids are enough to look a case up by hand.
 */
export function ReportsPanel({ adminUid }: { adminUid: string }) {
  const { notify } = useNotifications();
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<{ loadedKey: number; reports: AdminReport[]; error: string }>({
    loadedKey: -1,
    reports: [],
    error: "",
  });
  const [acting, setActing] = useState<string | null>(null);
  const [view, setView] = useState<ViewStatus>("pending");

  useEffect(() => {
    let stale = false;
    fetchReports(view)
      .then((reports) => {
        if (!stale) setState({ loadedKey: reloadKey, reports, error: "" });
      })
      .catch((err: unknown) => {
        if (!stale) setState({ loadedKey: reloadKey, reports: [], error: errorMessage(err, "Couldn't load reports.") });
      });
    return () => {
      stale = true;
    };
    // `view` is paired with a `reloadKey` bump by `selectView`, so switching
    // tabs flips `loading` immediately instead of showing the previous
    // status's rows until the new fetch resolves.
  }, [reloadKey, view]);

  const decide = async (report: AdminReport, verdict: Verdict): Promise<void> => {
    setActing(report.id);
    try {
      await resolveReport(adminUid, report.id, verdict);
      notify({
        type: "success",
        title: verdict === "resolved" ? "Report resolved" : "Report dismissed",
        message: `@${report.reportedUsername}`,
      });
      setReloadKey((key) => key + 1);
    } catch (err: unknown) {
      notify({ type: "error", title: "Action failed", message: errorMessage(err) });
    } finally {
      setActing(null);
    }
  };

  const loading = state.loadedKey !== reloadKey;

  const selectView = (next: ViewStatus): void => {
    if (next === view) return;
    setView(next);
    setReloadKey((key) => key + 1);
  };

  return (
    <section aria-label="Reports">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange">{view.toUpperCase()} REPORTS</h2>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={loading}
          aria-label="Refresh reports"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border text-muted transition-colors hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>

      <div role="tablist" aria-label="Report status" className="mb-4 flex gap-2">
        {VIEWS.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={view === status}
            onClick={() => selectView(status)}
            className={`inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border px-3 font-display text-[11px] tracking-[0.15em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${
              view === status
                ? "border-brand-orange/40 bg-brand-orange/[0.1] text-brand-orange"
                : "border-border text-muted hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading && <p className="font-body text-xs text-subtle">Loading reports...</p>}

      {!loading && state.error && (
        <p role="alert" className="font-body text-xs text-brand-red">
          {state.error}
        </p>
      )}

      {!loading && !state.error && state.reports.length === 0 && (
        <p
          data-testid="reports-empty"
          className="rounded-2xl border border-dashed border-border px-4 py-6 text-center font-body text-xs text-subtle"
        >
          No {view} reports
        </p>
      )}

      {!loading && !state.error && state.reports.length > 0 && (
        <ul className="flex flex-col gap-2">
          {state.reports.map((report) => (
            <li
              key={report.id}
              data-testid={`report-${report.id}`}
              className="rounded-2xl border border-border bg-surface p-3"
            >
              <p className="font-display text-sm text-white">@{report.reportedUsername}</p>
              <p className="mt-0.5 font-body text-xs text-muted">{reasonLabel(report.reason)}</p>

              {/* The reporter's own words — the evidence the verdict is being
                  made on. Rendered as a plain text node so React escapes it:
                  this is untrusted user input and must never reach innerHTML.
                  `whitespace-pre-wrap` keeps the reporter's line breaks, and a
                  capped scroll box (the app's existing overflow idiom) stops a
                  500-char wall of text pushing the verdict buttons off screen. */}
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
                <p
                  data-testid={`report-clip-${report.id}`}
                  className="mt-2 font-mono text-[11px] break-all text-subtle"
                >
                  clip {report.clipId}
                </p>
              )}

              <p className="mt-1 font-body text-[11px] text-faint break-all">
                {relativeAge(report.createdAt)} · game {report.gameId} · reporter {report.reporterUid}
              </p>
              {/* Resolution audit trail. Only a report that already carries a
                  verdict has one; reports resolved before the audit fields
                  shipped render "unknown" rather than being hidden, so the
                  verdict itself is never silently dropped from the row. */}
              {report.status !== "pending" && (
                <p
                  data-testid={`report-resolution-${report.id}`}
                  className="mt-1 font-body text-[11px] text-faint break-all"
                >
                  {report.status} by {report.resolvedBy || "unknown"} · {relativeAge(report.resolvedAt)}
                </p>
              )}

              {/* Verdict controls are pending-only: firestore.rules gates the
                  report update on `resource.data.status == 'pending'`, so
                  offering them on an already-closed report would hand the
                  operator a guaranteed permission-denied. */}
              {report.status === "pending" && (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void decide(report, "resolved")}
                    disabled={acting === report.id}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-brand-green/40 bg-brand-green/[0.1] px-3 font-display text-[11px] tracking-[0.15em] text-brand-green transition-colors active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {acting === report.id ? "..." : "RESOLVE"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void decide(report, "dismissed")}
                    disabled={acting === report.id}
                    className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-border px-3 font-display text-[11px] tracking-[0.15em] text-muted transition-colors hover:text-white active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {acting === report.id ? "..." : "DISMISS"}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
