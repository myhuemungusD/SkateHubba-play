import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Send } from "lucide-react";
import type { SpotComment } from "../../types/spot";
import { addSpotComment } from "../../services/spots";
import { getBlockedUserIds } from "../../services/blocking";

const ReportModal = lazy(() => import("../ReportModal").then((m) => ({ default: m.ReportModal })));

export interface SpotCommentsProps {
  spotId: string;
  comments: SpotComment[];
  onPosted: (comment: SpotComment) => void;
  /** Signed-in viewer, or `null` when signed out. */
  viewer: { uid: string; username: string } | null;
}

/**
 * Comment thread on a spot page.
 *
 * Every comment that isn't the viewer's own carries a REPORT control, and
 * comments from players the viewer blocked are left out. App Review 1.2
 * requires both for user text: a way to flag it, and a way to stop seeing
 * someone. Authors show by handle; older comments stored no handle, so they
 * show a neutral label instead of any part of the account id.
 */
export function SpotComments({ spotId, comments, onPosted, viewer }: SpotCommentsProps) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ReadonlySet<string>>(new Set());
  const [reporting, setReporting] = useState<SpotComment | null>(null);
  const viewerUid = viewer?.uid ?? "";

  useEffect(() => {
    if (!viewerUid) return;
    let cancelled = false;
    void getBlockedUserIds(viewerUid).then((ids) => {
      if (!cancelled) setBlocked(ids);
    });
    return () => {
      cancelled = true;
    };
  }, [viewerUid]);

  // The send button is disabled while the draft is blank, so `submit` only
  // runs with real text.
  const submit = useCallback(async () => {
    if (!viewer) {
      setError("You must be signed in to comment");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      onPosted(await addSpotComment(spotId, text.trim(), viewer.uid, viewer.username));
      setText("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setSubmitting(false);
    }
  }, [text, viewer, spotId, onPosted]);

  const visible = comments.filter((c) => !blocked.has(c.userId));

  return (
    <div>
      <h3 className="text-sm font-semibold mb-3">Comments</h3>

      <div className="flex gap-2 mb-4">
        <input
          type="text"
          maxLength={300}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment…"
          className="flex-1 bg-surface-alt border border-[#333] rounded-lg px-3 py-2 text-white text-base
                     placeholder:text-subtle focus:outline-none focus:border-[#F97316]"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting || !text.trim()}
          className="touch-target min-w-[44px] inline-flex items-center justify-center px-3 py-2 bg-[#F97316] text-white rounded-lg
                     hover:bg-[#EA580C] disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Send comment"
        >
          <Send size={16} />
        </button>
      </div>

      {error && <p className="text-red-400 text-xs mb-3">{error}</p>}

      {visible.length === 0 ? (
        <p className="text-subtle text-sm">No comments yet. Be the first!</p>
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <div key={c.id} data-testid={`spot-comment-${c.id}`} className="bg-surface-alt rounded-lg p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted">{c.username ? `@${c.username}` : "skater"}</span>
                <span className="text-xs text-subtle">{new Date(c.createdAt).toLocaleDateString()}</span>
              </div>
              {/* Untrusted user text: a plain text node, so React escapes it. */}
              <p className="text-sm text-[#CCC] break-words whitespace-pre-wrap">{c.content}</p>
              {viewer && c.userId !== viewer.uid && (
                <button
                  type="button"
                  onClick={() => setReporting(c)}
                  aria-label={`Report comment by ${c.username ? `@${c.username}` : "this skater"}`}
                  className="mt-1 inline-flex min-h-[44px] items-center font-display text-[11px] tracking-[0.15em] text-faint transition-colors hover:text-brand-red focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
                >
                  REPORT
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {reporting && viewer && (
        <Suspense fallback={null}>
          <ReportModal
            reporterUid={viewer.uid}
            reportedUid={reporting.userId}
            reportedUsername={reporting.username ?? ""}
            gameId={null}
            spotId={spotId}
            comment={{ id: reporting.id, text: reporting.content }}
            onClose={() => setReporting(null)}
            onSubmitted={() => setReporting(null)}
          />
        </Suspense>
      )}
    </div>
  );
}
