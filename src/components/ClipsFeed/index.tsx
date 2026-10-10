import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ClipDoc } from "../../services/clips";
import type { UserProfile } from "../../services/users";
import { isFirebaseStorageUrl } from "../../utils/helpers";

const ReportModal = lazy(() => import("../ReportModal").then((m) => ({ default: m.ReportModal })));
const UserClipUploadModal = lazy(() => import("../UserClipUpload").then((m) => ({ default: m.UserClipUploadModal })));
const ClipComments = lazy(() => import("./ClipComments").then((m) => ({ default: m.ClipComments })));
import { ClipsFeedEmpty, ClipsFeedError, ClipsFeedExhausted, ClipsFeedSkeleton } from "./ClipsFeedStates";
import { OwnClipModeration } from "./OwnClipModeration";
import { ClipsFeedHeader } from "./ClipsFeedHeader";
import { DisputeSlides } from "./DisputeLane";
import { isNearSlide } from "./feedLayout";
import { NextClipPrefetcher } from "./NextClipPrefetcher";
import { SpotlightCard } from "./SpotlightCard";
import { useClipsFeedController } from "./useClipsFeedController";
import { useDisputeLaneController } from "./useDisputeLaneController";
import { useVerticalFeed } from "./useVerticalFeed";

export interface ClipsFeedProps {
  profile: UserProfile;
  /** Navigate to a player's public profile. */
  onViewPlayer: (uid: string) => void;
  /** Kick off a challenge flow against a username — used by the "Challenge" CTA. */
  onChallengeUser: (username: string) => void;
}

/**
 * Full-screen vertical feed. Open disputes come first — they are the pages
 * with a decision on them — then community clips in the active Top/New order.
 * One scroller, CSS scroll-snap, arrow keys on desktop. A vote updates the
 * page in place and never advances it.
 */
export function ClipsFeed({ profile, onViewPlayer, onChallengeUser }: ClipsFeedProps) {
  const clips = useClipsFeedController(profile.uid);
  const disputes = useDisputeLaneController(profile.uid);
  const [muted, setMuted] = useState(true);
  const [reportTarget, setReportTarget] = useState<ClipDoc | null>(null);
  const [commentsTarget, setCommentsTarget] = useState<ClipDoc | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [moderationRefresh, setModerationRefresh] = useState(0);

  const pendingTarget = useRef<number | null>(null);
  const wasLoadingMore = useRef(false);
  const wasBlocking = useRef(true);
  // Error takes one leading page; open disputes take one each.
  const leading = disputes.error ? 1 : disputes.disputes.length;
  const leadingRef = useRef(leading);
  const clipCountRef = useRef(clips.visibleClips.length);
  useEffect(() => {
    leadingRef.current = leading;
    clipCountRef.current = clips.visibleClips.length;
  }, [leading, clips.visibleClips.length]);

  const onPastEnd = useCallback(() => {
    if (!clips.hasMore || clips.loadingMore) return;
    pendingTarget.current = leadingRef.current + clipCountRef.current;
    void clips.loadMore();
  }, [clips]);

  const blocking = !clips.error && (clips.loading || disputes.loading);
  const slideCount = blocking ? 0 : leading + clips.visibleClips.length;
  const { setScroller, activeIndex, scrollToIndex, reset } = useVerticalFeed(slideCount, onPastEnd);

  useEffect(() => {
    if (wasBlocking.current && !blocking) reset();
    wasBlocking.current = blocking;
  }, [blocking, reset]);

  useEffect(() => {
    const finished = wasLoadingMore.current && !clips.loadingMore;
    wasLoadingMore.current = clips.loadingMore;
    if (!finished) return;
    const target = pendingTarget.current;
    pendingTarget.current = null;
    const total = leadingRef.current + clipCountRef.current;
    if (target !== null && target < total) scrollToIndex(target);
  }, [clips.loadingMore, clips.visibleClips.length, scrollToIndex]);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const hasSlides = disputes.disputes.length > 0 || clips.visibleClips.length > 0;
  const showSlides = !blocking && (hasSlides || Boolean(disputes.error));
  const showEmpty = !blocking && !clips.error && !disputes.error && !hasSlides && !clips.exhausted;
  const showExhausted =
    !blocking && !clips.error && !disputes.error && clips.exhausted && disputes.disputes.length === 0;
  const nextSrc = nextSlideSrc(disputes.disputes, clips.visibleClips, activeIndex);

  return (
    <section className="relative h-full" aria-label="Community feed">
      <p className="sr-only">
        Swipe up or down, or use the arrow keys, to move between clips. Voting stays on the clip you are watching.
      </p>
      <ClipsFeedHeader
        sort={clips.sort}
        onSortChange={clips.handleSortChange}
        disabled={clips.loading || clips.loadingMore}
        position={showSlides && slideCount > 0 ? { index: activeIndex, total: slideCount } : undefined}
        onPostClip={() => setUploadOpen(true)}
      />

      <OwnClipModeration uid={profile.uid} refreshKey={moderationRefresh} />

      {blocking && <ClipsFeedSkeleton />}

      {clips.error && !clips.loading && (
        <div className="absolute inset-x-4 top-24 z-30">
          <ClipsFeedError error={clips.error} errorCode={clips.errorCode} onRetry={clips.loadPool} />
        </div>
      )}

      {showEmpty && (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-6">
          <ClipsFeedEmpty />
        </div>
      )}

      {showExhausted && (
        <div className="absolute inset-0 z-20 flex items-center justify-center px-6">
          <ClipsFeedExhausted onReload={clips.hasMore ? clips.loadMore : clips.loadPool} />
        </div>
      )}

      {showSlides && (
        <div
          ref={setScroller}
          tabIndex={0}
          role="region"
          aria-label="Clips"
          aria-keyshortcuts="ArrowUp ArrowDown"
          className="h-full overflow-y-auto overscroll-y-contain snap-y snap-mandatory outline-none motion-reduce:scroll-auto"
        >
          <DisputeSlides state={disputes} activeIndex={activeIndex} muted={muted} onToggleMute={toggleMute} />
          {!disputes.loading &&
            clips.visibleClips.map((clip, index) => {
              const slideIndex = disputes.disputes.length + index;
              return (
                <SpotlightCard
                  key={clip.id}
                  clip={clip}
                  isOwnClip={clip.playerUid === profile.uid}
                  vote={clips.voteFor(clip.id)}
                  voting={clips.isVoting(clip.id)}
                  active={activeIndex === slideIndex}
                  near={isNearSlide(slideIndex, activeIndex)}
                  muted={muted}
                  onToggleMute={toggleMute}
                  onViewPlayer={onViewPlayer}
                  onUpvote={clips.handleUpvote}
                  onDownvote={clips.handleDownvote}
                  onChallenge={onChallengeUser}
                  onReport={setReportTarget}
                  onComments={setCommentsTarget}
                />
              );
            })}
          <NextClipPrefetcher src={nextSrc} />
        </div>
      )}

      {commentsTarget && (
        <Suspense fallback={null}>
          <ClipComments
            key={commentsTarget.id}
            clip={commentsTarget}
            viewerUid={profile.uid}
            viewerUsername={profile.username}
            blockedUids={clips.blockedUids}
            onClose={() => setCommentsTarget(null)}
            onReport={() => {
              setCommentsTarget(null);
              setReportTarget(commentsTarget);
            }}
          />
        </Suspense>
      )}

      {uploadOpen && (
        <Suspense fallback={null}>
          <UserClipUploadModal
            uid={profile.uid}
            username={profile.username}
            onClose={() => setUploadOpen(false)}
            onPosted={() => {
              setUploadOpen(false);
              setModerationRefresh((key) => key + 1);
              void clips.loadPool();
            }}
          />
        </Suspense>
      )}

      {reportTarget && (
        <Suspense fallback={null}>
          <ReportModal
            reporterUid={profile.uid}
            reportedUid={reportTarget.playerUid}
            reportedUsername={reportTarget.playerUsername}
            gameId={reportTarget.gameId}
            clipId={reportTarget.id}
            onClose={() => setReportTarget(null)}
            onSubmitted={() => {
              clips.dismissClip(reportTarget.id);
              setReportTarget(null);
            }}
          />
        </Suspense>
      )}
    </section>
  );
}

function nextSlideSrc(
  disputeList: readonly { matchVideoUrl: string }[],
  clipList: readonly { videoUrl: string }[],
  activeIndex: number,
): string | null {
  const next = activeIndex + 1;
  if (next < disputeList.length) {
    const url = disputeList[next]?.matchVideoUrl;
    return url && isFirebaseStorageUrl(url) ? url : null;
  }
  const clip = clipList[next - disputeList.length];
  return clip?.videoUrl ?? null;
}
