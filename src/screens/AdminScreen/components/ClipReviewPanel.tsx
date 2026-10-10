import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  decideClipModeration,
  fetchClipsInReview,
  type ReviewClip,
  type ReviewCursor,
} from "../../../services/clipModeration";
import { useNotifications } from "../../../context/NotificationContext";
import { errorMessage } from "../utils";

/**
 * Clips the screener or the community hid for a person to look at.
 * Keep puts the clip in the feed. Remove hides it and tells the owner why.
 */
export function ClipReviewPanel() {
  const { notify } = useNotifications();
  const [reloadKey, setReloadKey] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [state, setState] = useState<{
    loadedKey: number;
    clips: ReviewClip[];
    cursor: ReviewCursor | null;
    error: string;
  }>({
    loadedKey: -1,
    clips: [],
    cursor: null,
    error: "",
  });

  useEffect(() => {
    let stale = false;
    fetchClipsInReview()
      .then((page) => {
        if (!stale) setState({ loadedKey: reloadKey, clips: page.clips, cursor: page.cursor, error: "" });
      })
      .catch((err: unknown) => {
        if (!stale)
          setState({ loadedKey: reloadKey, clips: [], cursor: null, error: errorMessage(err, "Couldn't load clips.") });
      });
    return () => {
      stale = true;
    };
  }, [reloadKey]);

  const loading = state.loadedKey !== reloadKey;

  const loadMore = async (): Promise<void> => {
    if (!state.cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchClipsInReview(state.cursor);
      setState((prev) => ({ ...prev, clips: [...prev.clips, ...page.clips], cursor: page.cursor, error: "" }));
    } catch (err: unknown) {
      setState((prev) => ({ ...prev, error: errorMessage(err, "Couldn't load clips.") }));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <section aria-label="Clips in review">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange">CLIPS IN REVIEW</h2>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={loading}
          aria-label="Refresh clips"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-border text-muted"
        >
          <RefreshCw size={16} strokeWidth={2} aria-hidden="true" />
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mb-3 font-body text-sm text-brand-red">
          {state.error}
        </p>
      )}
      {loading && <p className="font-body text-sm text-muted">Loading…</p>}
      {!loading && state.clips.length === 0 && !state.error && (
        <p data-testid="clip-review-empty" className="font-body text-sm text-muted">
          No clips waiting.
        </p>
      )}
      <ul className="space-y-4">
        {state.clips.map((clip) => (
          <ReviewCard
            key={clip.id}
            clip={clip}
            onDone={(message) => {
              notify({ type: "success", title: "Clip updated", message });
              setReloadKey((key) => key + 1);
            }}
            onError={(message) => notify({ type: "error", title: "Action failed", message })}
          />
        ))}
      </ul>
      {state.cursor && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loadingMore}
          className="mt-4 min-h-[44px] w-full rounded-xl border border-border font-display text-xs tracking-wider text-white disabled:opacity-40"
        >
          {loadingMore ? "Loading…" : "Load more"}
        </button>
      )}
    </section>
  );
}

function ReviewCard({
  clip,
  onDone,
  onError,
}: {
  clip: ReviewClip;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (decision: "approved" | "removed"): Promise<void> => {
    setBusy(true);
    try {
      await decideClipModeration(clip.id, decision, reason);
      onDone(decision === "approved" ? `@${clip.playerUsername} stays up` : `@${clip.playerUsername} removed`);
    } catch (err: unknown) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li data-testid={`review-${clip.id}`} className="rounded-2xl border border-border bg-surface p-4">
      <video src={clip.videoUrl} controls className="mb-3 w-full rounded-xl bg-black" />
      <p className="font-body text-sm text-white">
        @{clip.playerUsername} · {clip.trickName}
      </p>
      <p className="mt-1 font-body text-xs text-muted">
        AI {clip.explicitLikelihood}
        {clip.skateDetected ? ` · skate: ${clip.skateLabels.join(", ") || "yes"}` : " · no skateboard"}
      </p>
      <p className="font-body text-xs text-muted">
        Reports: {clip.reportReasons.length > 0 ? clip.reportReasons.join(", ") : "none"}
        {clip.grounds ? ` · ${clip.grounds}` : ""}
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("approved")}
          className="min-h-[44px] flex-1 rounded-xl bg-brand-green/20 font-display text-xs tracking-wider text-brand-green"
        >
          Keep
        </button>
      </div>
      <label className="mt-3 block font-body text-xs text-muted" htmlFor={`remove-${clip.id}`}>
        Reason for removal
      </label>
      <input
        id={`remove-${clip.id}`}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        maxLength={200}
        className="mt-1 w-full rounded-xl border border-border bg-surface-alt px-3 py-3 font-body text-sm text-white"
      />
      <button
        type="button"
        disabled={busy || reason.trim().length === 0}
        onClick={() => void act("removed")}
        className="mt-2 min-h-[44px] w-full rounded-xl bg-brand-red/20 font-display text-xs tracking-wider text-brand-red disabled:opacity-40"
      >
        Remove
      </button>
    </li>
  );
}
