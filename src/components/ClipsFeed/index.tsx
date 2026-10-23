import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ClipDoc } from "../../services/clips";
import type { UserProfile } from "../../services/users";
import type { Dispute } from "../../types/dispute";
import { isFirebaseStorageUrl } from "../../utils/helpers";
import { isFeedModesEnabled, isWttEnabled } from "../../lib/featureFlags";
import { useFeedMode } from "../../hooks/useFeedMode";

const FeedModeToggle = lazy(() => import("../FeedModeToggle").then((m) => ({ default: m.FeedModeToggle })));
import { ClipsFeedEmpty, ClipsFeedError, ClipsFeedExhausted, ClipsFeedSkeleton } from "./ClipsFeedStates";
import { OwnClipModeration } from "./OwnClipModeration";
import { ClipsFeedHeader } from "./ClipsFeedHeader";
import { DisputeSlides, disputeSlideCount } from "./DisputeLane";
import { FeedModals, type CommentReportTarget } from "./FeedModals";
import { isNearSlide } from "./feedLayout";
import { NextClipPrefetcher } from "./NextClipPrefetcher";
import { SpotlightCard } from "./SpotlightCard";
import { WttNameItOverlay } from "./WttNameItOverlay";
import { useClipsFeedController } from "./useClipsFeedController";
import { useDisputeLaneController } from "./useDisputeLaneController";
import { useVerticalFeed } from "./useVerticalFeed";
import { useWttFeed } from "../../hooks/useWttFeed";

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
 *
 * When feed modes are enabled, shows a mode switcher (Scroll · Name It · Vote · Judge).
 * Name It mode shows WTT quiz cards; Vote mode emphasizes voting; Judge shows disputes.
 */
export function ClipsFeed({ profile, onViewPlayer, onChallengeUser }: ClipsFeedProps) {
  const feedModesEnabled = isFeedModesEnabled();
  const wttEnabled = isWttEnabled();
  const { mode, setMode } = useFeedMode();

  const clips = useClipsFeedController(profile.uid);
  const disputes = useDisputeLaneController(profile.uid);

  const [muted, setMuted] = useState(true);
  const [reportTarget, setReportTarget] = useState<ClipDoc | null>(null);
  const [disputeReport, setDisputeReport] = useState<Dispute | null>(null);
  const [commentsTarget, setCommentsTarget] = useState<ClipDoc | null>(null);
  const [commentReport, setCommentReport] = useState<CommentReportTarget | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [moderationRefresh, setModerationRefresh] = useState(0);

  // Only use feed mode and WTT when features are enabled
  const activeMode = feedModesEnabled ? mode : ("scroll" as const);
  // The WTT queue only loads once Name It is actually open, so the flag-off
  // feed never touches the wtt collections.
  const nameItOpen = wttEnabled && activeMode === "name-it";
  const wtt = useWttFeed(profile.uid, nameItOpen);

  const pendingTarget = useRef<number | null>(null);
  const wasLoadingMore = useRef(false);
  const wasBlocking = useRef(true);
  // Match the pages DisputeSlides mounts: one for loading or error, else one per dispute.
  const leading = disputeSlideCount(disputes);
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
  const nextSrc = nextSlideSrc(leading, disputes.disputes, clips.visibleClips, activeIndex);

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

      {feedModesEnabled && (
        <Suspense fallback={null}>
          <div className="absolute inset-x-0 top-16 z-20">
            <FeedModeToggle
              mode={activeMode}
              onChange={setMode}
              disabled={clips.loading || disputes.loading}
              showJudge={disputes.disputes.length > 0}
              showNameIt={wttEnabled}
              disputesPending={disputes.disputes.length > 0}
              streakDue={nameItOpen && wtt.dailyCount === 0 && wtt.reliability?.streakDays === 0}
            />
          </div>
        </Suspense>
      )}

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
          <DisputeSlides
            state={disputes}
            viewerUid={profile.uid}
            onReport={setDisputeReport}
            activeIndex={activeIndex}
            muted={muted}
            onToggleMute={toggleMute}
          />
          {!disputes.loading &&
            clips.visibleClips.map((clip, index) => {
              const slideIndex = leading + index;
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

      {nameItOpen && (
        <WttNameItOverlay
          currentItem={wtt.currentItem}
          dailyCount={wtt.dailyCount}
          dailyLimit={wtt.dailyLimit}
          loading={wtt.loading}
          onAnswer={wtt.submitAnswer}
          onSkipCurrent={wtt.skipCurrent}
          onBackToScroll={() => setMode("scroll")}
        />
      )}

      <FeedModals
        uid={profile.uid}
        username={profile.username}
        blockedUids={clips.blockedUids}
        commentsTarget={commentsTarget}
        onCloseComments={() => setCommentsTarget(null)}
        onReportFromComments={(clip) => {
          setCommentsTarget(null);
          setReportTarget(clip);
        }}
        onReportComment={(target) => {
          setCommentsTarget(null);
          setCommentReport(target);
        }}
        onViewPlayer={(playerUid) => {
          setCommentsTarget(null);
          onViewPlayer(playerUid);
        }}
        uploadOpen={uploadOpen}
        onCloseUpload={() => setUploadOpen(false)}
        onPosted={() => {
          setUploadOpen(false);
          setModerationRefresh((key) => key + 1);
          void clips.loadPool();
        }}
        disputeReport={disputeReport}
        onCloseDisputeReport={() => setDisputeReport(null)}
        reportTarget={reportTarget}
        onCloseClipReport={() => setReportTarget(null)}
        onClipReportSubmitted={(clip) => {
          clips.dismissClip(clip.id);
          setReportTarget(null);
        }}
        commentReport={commentReport}
        onCloseCommentReport={() => setCommentReport(null)}
      />
    </section>
  );
}

function nextSlideSrc(
  leadingSlides: number,
  disputeList: readonly { matchVideoUrl: string }[],
  clipList: readonly { videoUrl: string }[],
  activeIndex: number,
): string | null {
  const next = activeIndex + 1;
  if (next < leadingSlides) {
    const url = disputeList[next]?.matchVideoUrl;
    return url && isFirebaseStorageUrl(url) ? url : null;
  }
  const clip = clipList[next - leadingSlides];
  return clip?.videoUrl ?? null;
}
