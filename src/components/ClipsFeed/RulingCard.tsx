import { memo } from "react";
import { GavelIcon } from "../icons";
import { isFirebaseStorageUrl } from "../../utils/helpers";
import type { PendingRuling } from "./pendingRulings";

export interface RulingCardProps {
  ruling: PendingRuling;
  submitting: boolean;
  error: string | null;
  /** `accept` = LANDED (dispute) / CLEAN (setReview). */
  onRule: (ruling: PendingRuling, accept: boolean) => void;
  /** Opens the full game screen for the disputed turn. */
  onOpenGame: (gameId: string) => void;
}

/** Copy differs per ruling kind — the two flows resolve different claims. */
const COPY = {
  dispute: {
    badge: "REFEREE'S CALL",
    accept: "LANDED",
    reject: "MISSED",
    acceptHint: "Match stands — roles swap",
    rejectHint: "Matcher takes a letter",
  },
  setReview: {
    badge: "CALL BS — YOUR RULING",
    accept: "CLEAN",
    reject: "SKETCHY",
    acceptHint: "Set stands — matcher must attempt",
    rejectHint: "Setter has to re-set",
  },
} as const;

function deadlineCopy(deadlineMs: number): string {
  if (deadlineMs <= 0) return "";
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return "Expiring now";
  const hours = remaining / 3_600_000;
  if (hours >= 1) return `${Math.floor(hours)}h left to rule`;
  const minutes = Math.max(1, Math.floor(remaining / 60_000));
  return `${minutes}m left to rule`;
}

/**
 * A dispute awaiting this viewer's ruling, rendered inline in the feed.
 *
 * Videos use native `controls` rather than the autoplay SpotlightVideo: a
 * referee needs scrubbing and replay to make a call, and two clips playing
 * at once would fight for the audio channel. `isFirebaseStorageUrl` gates
 * each `src` — the same defence the game screen's DisputeReviewPanel
 * applies before rendering a URL that came off a game doc.
 */
export const RulingCard = memo(function RulingCard({ ruling, submitting, error, onRule, onOpenGame }: RulingCardProps) {
  const copy = COPY[ruling.kind];
  const remaining = deadlineCopy(ruling.deadlineMs);

  return (
    <article
      className="glass-card rounded-2xl overflow-hidden border border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.06)]"
      aria-label={`Ruling needed on ${ruling.trickName}`}
    >
      <div className="px-4 pt-3.5 pb-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-display text-[11px] tracking-[0.2em] text-amber-400">
          <GavelIcon size={13} className="text-amber-400" />
          {copy.badge}
        </span>
        {remaining && <span className="font-body text-[11px] text-faint">{remaining}</span>}
      </div>

      <div className="px-4">
        <h2 className="font-display text-xl text-white tracking-wide leading-tight">{ruling.trickName}</h2>
        <p className="font-body text-sm text-muted mt-1">
          {ruling.kind === "dispute" ? (
            <>
              @{ruling.matcherUsername} claims they landed @{ruling.setterUsername}&apos;s trick. Watch both and rule.
            </>
          ) : (
            <>
              @{ruling.matcherUsername} called BS on @{ruling.setterUsername}&apos;s set. Was it clean?
            </>
          )}
        </p>
      </div>

      <div className="px-4 pt-3 grid gap-3 sm:grid-cols-2">
        {ruling.setVideoUrl && isFirebaseStorageUrl(ruling.setVideoUrl) && (
          <div>
            <p className="font-display text-[11px] tracking-[0.15em] text-brand-orange mb-1.5">
              @{ruling.setterUsername.toUpperCase()}&apos;S SET
            </p>
            <video
              src={ruling.setVideoUrl}
              controls
              playsInline
              preload="metadata"
              aria-label={`${ruling.setterUsername}'s ${ruling.trickName} video`}
              className="w-full aspect-[9/16] max-h-[420px] rounded-xl bg-black object-cover border border-border"
            />
          </div>
        )}
        {ruling.matchVideoUrl && isFirebaseStorageUrl(ruling.matchVideoUrl) && (
          <div>
            <p className="font-display text-[11px] tracking-[0.15em] text-brand-green mb-1.5">
              @{ruling.matcherUsername.toUpperCase()}&apos;S ATTEMPT
            </p>
            <video
              src={ruling.matchVideoUrl}
              controls
              playsInline
              preload="metadata"
              aria-label={`${ruling.matcherUsername}'s attempt video`}
              className="w-full aspect-[9/16] max-h-[420px] rounded-xl bg-black object-cover border border-border"
            />
          </div>
        )}
      </div>

      {error && (
        <p role="alert" className="px-4 pt-3 font-body text-sm text-brand-red">
          {error}
        </p>
      )}

      <div className="px-4 pt-3 pb-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onRule(ruling, true)}
          disabled={submitting}
          aria-label={`${copy.accept} — ${copy.acceptHint}`}
          className="flex-1 min-h-[44px] flex flex-col items-center justify-center rounded-xl font-display text-sm tracking-wider bg-brand-green/15 border border-brand-green/40 text-brand-green hover:bg-brand-green/25 active:scale-[0.97] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-green"
        >
          <span>{copy.accept}</span>
          <span className="font-body text-[10px] tracking-normal text-brand-green/70">{copy.acceptHint}</span>
        </button>
        <button
          type="button"
          onClick={() => onRule(ruling, false)}
          disabled={submitting}
          aria-label={`${copy.reject} — ${copy.rejectHint}`}
          className="flex-1 min-h-[44px] flex flex-col items-center justify-center rounded-xl font-display text-sm tracking-wider bg-brand-red/15 border border-brand-red/40 text-brand-red hover:bg-brand-red/25 active:scale-[0.97] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
        >
          <span>{copy.reject}</span>
          <span className="font-body text-[10px] tracking-normal text-brand-red/70">{copy.rejectHint}</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenGame(ruling.gameId)}
          aria-label="Open the full game to review"
          className="min-h-[44px] inline-flex items-center justify-center rounded-xl px-3.5 font-display text-[11px] tracking-[0.15em] text-faint border border-border hover:text-white hover:border-border-hover hover:bg-white/[0.02] transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          GAME
        </button>
      </div>
    </article>
  );
});
