import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { loadClipAppeal, submitClipAppeal, type ClipAppealView } from "../services/clipModeration";

/**
 * The owner reads the statement of reasons and can ask for another look.
 * One appeal per clip. The link in the notification opens this screen.
 */
export function ClipAppealScreen({
  uid,
  statementId,
  onBack,
}: {
  uid: string;
  statementId: string;
  onBack: () => void;
}) {
  const [view, setView] = useState<ClipAppealView | null>(null);
  const [error, setError] = useState("");
  const [statement, setStatement] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let stale = false;
    loadClipAppeal(uid, statementId)
      .then((next) => {
        if (!stale) setView(next);
      })
      .catch((err: unknown) => {
        if (!stale) setError(err instanceof Error ? err.message : "Couldn't open that appeal.");
      });
    return () => {
      stale = true;
    };
  }, [uid, statementId]);

  const send = async (): Promise<void> => {
    setSending(true);
    setError("");
    try {
      await submitClipAppeal(uid, statementId, statement);
      setSent(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Couldn't send your appeal.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background px-5 pt-safe pb-16">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back"
        className="mb-6 inline-flex min-h-[44px] items-center gap-2 font-body text-xs text-muted"
      >
        <ChevronLeft size={16} aria-hidden="true" />
        Back
      </button>
      <h1 className="font-display text-2xl text-white">Appeal</h1>
      {!view && !error && <p className="mt-4 font-body text-sm text-muted">Loading…</p>}
      {error && (
        <p role="alert" className="mt-4 font-body text-sm text-brand-red">
          {error}
        </p>
      )}
      {view && (
        <div className="mt-4">
          <p className="font-body text-sm text-white">{view.trickName}</p>
          <p className="mt-2 font-body text-sm text-muted">{view.statement || "No statement was recorded."}</p>
          {sent && <p className="mt-4 font-body text-sm text-brand-green">Appeal sent. We'll take another look.</p>}
          {view.canAppeal && !sent && (
            <>
              <label htmlFor="appeal-statement" className="mt-4 block font-body text-xs text-muted">
                Why should this change?
              </label>
              <textarea
                id="appeal-statement"
                value={statement}
                onChange={(event) => setStatement(event.target.value)}
                maxLength={1000}
                rows={4}
                className="mt-1 w-full rounded-2xl border border-border bg-surface px-4 py-3 font-body text-sm text-white"
              />
              <button
                type="button"
                disabled={sending || statement.trim().length === 0}
                onClick={() => void send()}
                className="mt-3 min-h-[44px] w-full rounded-2xl bg-brand-orange font-display tracking-wider text-white disabled:opacity-40"
              >
                {sending ? "Sending…" : "Send appeal"}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
