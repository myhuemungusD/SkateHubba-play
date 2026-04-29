import type { ClipDoc } from "../../services/clips";
import type { ClipUpvoteState } from "../../services/clips";
import { ProUsername } from "../ProUsername";
import { ClipActions } from "./ClipActions";
import { SpotlightVideo } from "./SpotlightVideo";
import { relativeClipTime } from "./utils";

export interface SpotlightCardProps {
  clip: ClipDoc;
  isOwnClip: boolean;
  upvote: ClipUpvoteState;
  upvoteDisabled: boolean;
  onViewPlayer: (uid: string) => void;
  onNext: () => void;
  onUpvote: (clip: ClipDoc) => void;
  onChallenge: (username: string) => void;
  onReport: (clip: ClipDoc) => void;
}

/**
 * The lobby's "Featured Clip" surface — author chip, role badge, video,
 * trick name, and the action row (upvote / challenge / report).
 *
 * Pure presentation: data + handlers in, JSX out. Lives next to ClipsFeed
 * so the parent stays inside the 250 LOC component budget.
 */
export function SpotlightCard({
  clip,
  isOwnClip,
  upvote,
  upvoteDisabled,
  onViewPlayer,
  onNext,
  onUpvote,
  onChallenge,
  onReport,
}: SpotlightCardProps) {
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

      <div className="px-4 pt-3">
        <h2 className="font-display text-xl text-white tracking-wide leading-tight">{clip.trickName}</h2>
      </div>

      <ClipActions
        clip={clip}
        isOwnClip={isOwnClip}
        upvote={upvote}
        upvoteDisabled={upvoteDisabled}
        onUpvote={onUpvote}
        onChallenge={onChallenge}
        onReport={onReport}
      />
    </article>
  );
}
