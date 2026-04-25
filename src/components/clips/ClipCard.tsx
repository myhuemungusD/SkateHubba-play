import type { ClipDoc, ClipUpvoteState } from "../../services/clips";
import { ChevronRightIcon, FlagIcon, FlameIcon } from "../icons";
import { ProUsername } from "../ProUsername";
import { SpotlightVideo } from "./SpotlightVideo";
import { relativeClipTime } from "./useClipsFeed";

export interface ClipCardProps {
  clip: ClipDoc;
  isOwnClip: boolean;
  upvote: ClipUpvoteState;
  upvoteDisabled: boolean;
  onViewPlayer: (uid: string) => void;
  onChallengeUser: (username: string) => void;
  onUpvote: (clip: ClipDoc) => void;
  onReport: (clip: ClipDoc) => void;
  onNext: () => void;
}

/**
 * Spotlight clip card: header (player + role + timestamp), the one-shot video,
 * trick name, and the action row (upvote, challenge, report).
 */
export function ClipCard({
  clip,
  isOwnClip,
  upvote,
  upvoteDisabled,
  onViewPlayer,
  onChallengeUser,
  onUpvote,
  onReport,
  onNext,
}: ClipCardProps) {
  return (
    <article className="glass-card rounded-2xl overflow-hidden" aria-label="Current clip">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
        <button
          type="button"
          onClick={() => onViewPlayer(clip.playerUid)}
          className="flex items-center gap-2 touch-target rounded-xl px-1.5 py-1 -ml-1.5 hover:bg-white/[0.03] transition-colors duration-200 group"
        >
          <div className="w-7 h-7 rounded-full bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center shrink-0">
            <span className="font-display text-[11px] text-brand-orange leading-none">
              {clip.playerUsername[0]?.toUpperCase() ?? "?"}
            </span>
          </div>
          <ProUsername
            username={clip.playerUsername}
            className="font-body text-xs text-white/80 group-hover:text-brand-orange transition-colors duration-200"
          />
        </button>
        <div className="flex items-center gap-2">
          <span
            className={`font-display text-[10px] tracking-[0.2em] px-2 py-0.5 rounded-md border ${
              clip.role === "set"
                ? "text-brand-orange border-brand-orange/30 bg-brand-orange/5"
                : "text-brand-green border-brand-green/30 bg-brand-green/5"
            }`}
            aria-label={clip.role === "set" ? "Setter's landed trick" : "Matcher's landed response"}
          >
            {clip.role === "set" ? "SET" : "MATCH"}
          </span>
          <span className="font-body text-[11px] text-faint">{relativeClipTime(clip.createdAt)}</span>
        </div>
      </div>

      {/* Video — plays once, no loop, no auto-advance. `key={clip.id}`
          remounts (and resets ended/muted state) on every Next. */}
      <div className="px-4">
        <SpotlightVideo key={clip.id} src={clip.videoUrl} onNext={onNext} />
      </div>

      {/* Trick name */}
      <div className="px-4 pt-3">
        <h2 className="font-display text-xl text-white tracking-wide leading-tight">{clip.trickName}</h2>
      </div>

      {/* Actions — vote, challenge, report stay visible always. */}
      <div className="px-4 pt-3 pb-4 flex items-center gap-2">
        {!isOwnClip && (
          <button
            type="button"
            onClick={() => onUpvote(clip)}
            disabled={upvoteDisabled}
            aria-pressed={upvote.alreadyUpvoted}
            aria-label={
              upvote.alreadyUpvoted
                ? `Upvoted · ${upvote.count}`
                : `Upvote clip by @${clip.playerUsername} · current count ${upvote.count}`
            }
            className={`min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 border transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:cursor-not-allowed active:scale-[0.97] ${
              upvote.alreadyUpvoted
                ? "border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
                : "border-border bg-surface/60 text-white/90 hover:border-brand-orange/30 hover:bg-brand-orange/5"
            }`}
          >
            <FlameIcon size={14} className={upvote.alreadyUpvoted ? "text-brand-orange" : "text-brand-orange/80"} />
            <span className="font-display text-xs tracking-wider tabular-nums">{upvote.count}</span>
          </button>
        )}
        {!isOwnClip && (
          <button
            type="button"
            onClick={() => onChallengeUser(clip.playerUsername)}
            aria-label={`Challenge @${clip.playerUsername}`}
            className="flex-1 min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl font-display text-sm tracking-wider bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white active:scale-[0.97] hover:-translate-y-0.5 transition-all duration-300 shadow-[0_2px_12px_rgba(255,107,0,0.18)] ring-1 ring-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <span>Challenge</span>
            <ChevronRightIcon size={14} />
          </button>
        )}
        <button
          type="button"
          onClick={() => onReport(clip)}
          disabled={isOwnClip}
          aria-label={`Report clip by @${clip.playerUsername}`}
          className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl px-3.5 font-display text-[11px] tracking-[0.15em] text-faint border border-border hover:text-white hover:border-border-hover hover:bg-white/[0.02] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <FlagIcon size={13} />
          REPORT
        </button>
      </div>
    </article>
  );
}
