import { memo } from "react";
import type { ClipDoc } from "../../services/clips";
import type { ClipVoteState } from "../../services/clips.upvotes";
import { ProUsername } from "../ProUsername";
import { ClipActions } from "./ClipActions";
import { SpotlightVideo } from "./SpotlightVideo";
import { relativeClipTime } from "./utils";

export interface SpotlightCardProps {
  clip: ClipDoc;
  isOwnClip: boolean;
  vote: ClipVoteState;
  /** True while this clip's vote write is in flight — locks both thumbs. */
  voting: boolean;
  onViewPlayer: (uid: string) => void;
  onNext: () => void;
  onUpvote: (clip: ClipDoc) => void;
  onDownvote: (clip: ClipDoc) => void;
  onChallenge: (username: string) => void;
  onReport: (clip: ClipDoc) => void;
  onComments: (clip: ClipDoc) => void;
}

/**
 * Provenance badge. Game clips say which side of the turn they came from;
 * a clip a skater posted themselves has no role, so it says so rather than
 * borrowing "SET" and implying a game that never happened.
 */
function ClipBadge({ clip }: { clip: ClipDoc }) {
  if (clip.source === "user") {
    return (
      <span
        className="rounded-md border border-white/20 bg-white/5 px-2 py-0.5 font-display text-[10px] tracking-[0.2em] text-white/70"
        aria-label="Clip posted straight to the feed"
      >
        CLIP
      </span>
    );
  }
  return (
    <span
      className={`rounded-md border px-2 py-0.5 font-display text-[10px] tracking-[0.2em] ${
        clip.role === "set"
          ? "border-brand-orange/30 bg-brand-orange/5 text-brand-orange"
          : "border-brand-green/30 bg-brand-green/5 text-brand-green"
      }`}
      aria-label={clip.role === "set" ? "Setter's landed trick" : "Matcher's landed response"}
    >
      {clip.role === "set" ? "SET" : "MATCH"}
    </span>
  );
}

/**
 * The lobby's "Featured Clip" surface — author chip, role badge, video,
 * trick name, and the action row (thumbs up / thumbs down / challenge /
 * report).
 *
 * Pure presentation: data + handlers in, JSX out. Lives next to ClipsFeed
 * so the parent stays inside the 250 LOC component budget.
 */
// memo: ClipsFeed re-renders on every state mutation (upvote map, hydration,
// cursor index). Without memoization those would all re-render the spotlight
// subtree — including the video element, which is the most expensive child
// in the tree. All props are primitives, immutable Maps/Sets, or stable
// callbacks (see the ref-backed handler in ClipsFeed/index.tsx), so the
// default shallow comparator is sufficient.
export const SpotlightCard = memo(function SpotlightCard({
  clip,
  isOwnClip,
  vote,
  voting,
  onViewPlayer,
  onNext,
  onUpvote,
  onDownvote,
  onChallenge,
  onReport,
  onComments,
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
          <ClipBadge clip={clip} />
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
        vote={vote}
        voting={voting}
        onUpvote={onUpvote}
        onDownvote={onDownvote}
        onChallenge={onChallenge}
        onReport={onReport}
        onComments={onComments}
      />
    </article>
  );
});
