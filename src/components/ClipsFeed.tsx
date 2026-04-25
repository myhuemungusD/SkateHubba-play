import type { UserProfile } from "../services/users";
import { ClipCard } from "./clips/ClipCard";
import { ClipsFeedEmpty } from "./clips/ClipsFeedEmpty";
import { ClipsFeedError } from "./clips/ClipsFeedError";
import { ClipsFeedLoading } from "./clips/ClipsFeedLoading";
import { useClipsFeed } from "./clips/useClipsFeed";
import { ReportModal } from "./ReportModal";

export interface ClipsFeedProps {
  profile: UserProfile;
  /** Navigate to a player's public profile. */
  onViewPlayer: (uid: string) => void;
  /** Kick off a challenge flow against a username — used by the "Challenge" CTA. */
  onChallengeUser: (username: string) => void;
}

/**
 * Community clips spotlight, embedded inside the Lobby.
 *
 * Shows one random landed-trick clip at a time. The video plays through once
 * (no loop, no auto-advance); when it ends, the viewer picks REPLAY or
 * NEXT TRICK. Upvote, challenge-user, and report controls stay visible on
 * the action row below the video.
 *
 * Random pool is refetched (and reshuffled) transparently when the viewer
 * exhausts it with NEXT TRICK.
 */
export function ClipsFeed({ profile, onViewPlayer, onChallengeUser }: ClipsFeedProps) {
  const {
    loading,
    error,
    errorCode,
    visibleClips,
    currentClip,
    safeIndex,
    isOwnClip,
    upvote,
    upvoteDisabled,
    reportTarget,
    loadPool,
    handleNext,
    handleUpvote,
    openReport,
    closeReport,
    markReported,
  } = useClipsFeed(profile.uid);

  return (
    <section className="mb-6" aria-label="Community feed">
      {/* Section header */}
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">FEED</h3>
        {visibleClips.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
            {safeIndex + 1}/{visibleClips.length}
          </span>
        )}
      </div>

      {error && !loading && <ClipsFeedError message={error} errorCode={errorCode} onRetry={loadPool} />}

      {loading && <ClipsFeedLoading />}

      {!loading && !error && !currentClip && <ClipsFeedEmpty />}

      {!loading && currentClip && (
        <ClipCard
          clip={currentClip}
          isOwnClip={isOwnClip}
          upvote={upvote}
          upvoteDisabled={upvoteDisabled}
          onViewPlayer={onViewPlayer}
          onChallengeUser={onChallengeUser}
          onUpvote={handleUpvote}
          onReport={openReport}
          onNext={handleNext}
        />
      )}

      {reportTarget && (
        <ReportModal
          reporterUid={profile.uid}
          reportedUid={reportTarget.playerUid}
          reportedUsername={reportTarget.playerUsername}
          gameId={reportTarget.gameId}
          clipId={reportTarget.id}
          onClose={closeReport}
          onSubmitted={() => {
            markReported(reportTarget.id);
            closeReport();
          }}
        />
      )}
    </section>
  );
}
