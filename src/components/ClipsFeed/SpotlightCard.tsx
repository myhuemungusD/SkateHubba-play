import { memo } from "react";
import type { ClipDoc } from "../../services/clips";
import type { ClipVoteState } from "../../services/clips.upvotes";
import { ProUsername } from "../ProUsername";
import { ClipActions } from "./ClipActions";
import { ABOVE_NAV, FEED_SLIDE } from "./feedLayout";
import { CLIP_POSTER } from "../../lib/clipPoster";
import { SpotlightVideo } from "./SpotlightVideo";
import { relativeClipTime } from "./utils";

export interface SpotlightCardProps {
  clip: ClipDoc;
  isOwnClip: boolean;
  vote: ClipVoteState;
  /** True while this clip's vote write is in flight — locks both thumbs. */
  voting: boolean;
  /** This slide is the snapped page. Only then do the controls mount. */
  active: boolean;
  /** Mount the media element. False for slides far from the viewport. */
  near: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onViewPlayer: (uid: string) => void;
  onUpvote: (clip: ClipDoc) => void;
  onDownvote: (clip: ClipDoc) => void;
  onChallenge: (username: string) => void;
  onReport: (clip: ClipDoc) => void;
  onComments: (clip: ClipDoc) => void;
}

function ClipBadge({ clip }: { clip: ClipDoc }) {
  if (clip.source === "user") {
    return (
      <span
        className="rounded-md border border-white/20 bg-white/10 px-2 py-0.5 font-display text-[10px] tracking-[0.2em] text-white/80"
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
          ? "border-brand-orange/40 bg-brand-orange/15 text-brand-orange"
          : "border-brand-green/40 bg-brand-green/15 text-brand-green"
      }`}
      aria-label={clip.role === "set" ? "Setter's landed trick" : "Matcher's landed response"}
    >
      {clip.role === "set" ? "SET" : "MATCH"}
    </span>
  );
}

/**
 * One community clip as a full-screen page. Inactive pages keep their
 * accessible name so the scroller's length stays honest, and drop their
 * controls so a thumbs-up off screen can't steal a tap.
 */
export const SpotlightCard = memo(function SpotlightCard({
  clip,
  isOwnClip,
  vote,
  voting,
  active,
  near,
  muted,
  onToggleMute,
  onViewPlayer,
  onUpvote,
  onDownvote,
  onChallenge,
  onReport,
  onComments,
}: SpotlightCardProps) {
  return (
    <article
      data-feed-slide
      data-active={active ? "true" : "false"}
      aria-current={active ? "true" : undefined}
      aria-label={`Clip by @${clip.playerUsername}: ${clip.trickName}`}
      className={FEED_SLIDE}
    >
      {near ? (
        <SpotlightVideo
          key={clip.id}
          src={clip.videoUrl}
          active={active}
          muted={muted}
          onToggleMute={onToggleMute}
          mediaLabel={`${clip.playerUsername}'s ${clip.trickName}`}
        />
      ) : (
        <img
          src={CLIP_POSTER}
          alt=""
          width={360}
          height={640}
          decoding="async"
          loading="lazy"
          className="absolute inset-0 h-full w-full bg-black object-cover"
        />
      )}

      {active && (
        <>
          <div className={`absolute left-4 right-24 z-20 ${ABOVE_NAV}`}>
            <div className="mb-2 flex items-center gap-2">
              <ClipBadge clip={clip} />
              <span className="font-body text-[11px] text-white/70">{relativeClipTime(clip.createdAt)}</span>
            </div>
            <h2 className="font-display text-2xl leading-tight tracking-wide text-white drop-shadow">
              {clip.trickName}
            </h2>
            <button
              type="button"
              onClick={() => onViewPlayer(clip.playerUid)}
              className="mt-1 flex min-h-[44px] items-center gap-2 rounded-xl px-1.5 py-1 -ml-1.5 hover:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-white/15 bg-black/40">
                <span className="font-display text-[11px] leading-none text-white/90">
                  {clip.playerUsername[0]?.toUpperCase() ?? "?"}
                </span>
              </span>
              <ProUsername username={clip.playerUsername} className="font-body text-sm text-white/90" />
            </button>
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
        </>
      )}
    </article>
  );
});
