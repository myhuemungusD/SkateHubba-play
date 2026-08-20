import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { fetchReports, resolveReport, type AdminReport } from "../../../services/admin";
import { banUser } from "../../../services/admin.bans";
import { useNotifications } from "../../../context/NotificationContext";
import { errorMessage } from "../utils";
import { ReportRow } from "./ReportRow";

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
 * Pending report queue.
 *
 * Rows (and their controls) live in ReportRow / ReportRowActions — the panel
 * itself owns only the queue: which view is showing, the fetch, and the
 * writes. Reports filed against a user-posted clip carry no `gameId`; they
 * appear in the same queue and the row labels them rather than filtering them
 * out, because a clip with no game is exactly the content that most needs
 * looking at.
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

  /**
   * Ban the reported user. Deliberately does NOT resolve the report: the
   * verdict is a separate record of what the operator decided, and silently
   * closing the ticket would erase the distinction between "banned and
   * resolved" and "banned, still under review".
   */
  const ban = async (report: AdminReport): Promise<void> => {
    setActing(report.id);
    try {
      await banUser(report.reportedUid);
      notify({ type: "success", title: "User banned", message: `@${report.reportedUsername}` });
      setReloadKey((key) => key + 1);
    } catch (err: unknown) {
      notify({ type: "error", title: "Ban failed", message: errorMessage(err) });
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
            <ReportRow
              key={report.id}
              report={report}
              acting={acting === report.id}
              onResolve={(r) => void decide(r, "resolved")}
              onDismiss={(r) => void decide(r, "dismissed")}
              onBan={(r) => void ban(r)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
