import { lazy, Suspense, useState } from "react";
import type { ClipDoc } from "../../services/clips";
import type { UserProfile } from "../../services/users";

// ReportModal pulls in submitReport + REPORT_REASON_LABELS + useFocusTrap +
// the modal's own UI primitives. It only ever renders when a viewer taps
// REPORT — a rare interaction. Lazy-load it so the lobby's critical
// bundle skips the form code entirely. Suspense fallback is null because
// the modal is already state-gated; the brief import delay (~50ms on
// warm cache) happens AFTER the user has tapped, so it's invisible.
const ReportModal = lazy(() => import("../ReportModal").then((m) => ({ default: m.ReportModal })));
// Same reasoning for the two heaviest optional surfaces in the feed. The
// upload modal drags in the whole capture stack (VideoRecorder, the fisheye
// renderer, MediaRecorder plumbing) and the comment sheet drags in its own
// service + composer — neither belongs in the lobby's first paint, and both
// only mount after an explicit tap.
const UserClipUploadModal = lazy(() => import("../UserClipUpload").then((m) => ({ default: m.UserClipUploadModal })));
const ClipComments = lazy(() => import("./ClipComments").then((m) => ({ default: m.ClipComments })));
import { ClipsFeedEmpty, ClipsFeedError, ClipsFeedExhausted, ClipsFeedSkeleton } from "./ClipsFeedStates";
import { ClipsFeedHeader } from "./ClipsFeedHeader";
import { DisputeLane } from "./DisputeLane";
import { NextClipPrefetcher } from "./NextClipPrefetcher";
import { SpotlightCard } from "./SpotlightCard";
import { useClipsFeedController } from "./useClipsFeedController";

export interface ClipsFeedProps {
  profile: UserProfile;
  /** Navigate to a player's public profile. */
  onViewPlayer: (uid: string) => void;
  /** Kick off a challenge flow against a username — used by the "Challenge" CTA. */
  onChallengeUser: (username: string) => void;
}

/**
 * The lobby feed. Two lanes, in priority order:
 *
 *  1. **Disputes** — tricks the setter sent to the crowd instead of taking on
 *     the honor system. The attempt plays inline and any viewer who isn't in
 *     the game rules LAND or BAIL without leaving the lobby. Once ruled (or
 *     when the viewer can't vote) the card stays put and shows the live
 *     tally. Owned by {@link DisputeLane}.
 *
 *  2. **Community clips** — landed tricks from across the app plus clips
 *     skaters post directly, one at a time, ordered by `sort` (Top:
 *     `upvoteCount` desc; New: reverse-chrono). Both thumbs are persisted
 *     tallies and neither hides the clip. Comments, challenge and report sit
 *     alongside; POST in the header opens the upload flow.
 */
export function ClipsFeed({ profile, onViewPlayer, onChallengeUser }: ClipsFeedProps) {
  const c = useClipsFeedController(profile.uid);

  const [reportTarget, setReportTarget] = useState<ClipDoc | null>(null);
  const [commentsTarget, setCommentsTarget] = useState<ClipDoc | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const { currentClip, nextClip } = c;
  const isOwnClip = currentClip ? currentClip.playerUid === profile.uid : false;

  return (
    <section className="mb-6" aria-label="Community feed">
      <DisputeLane viewerUid={profile.uid} />

      <ClipsFeedHeader
        sort={c.sort}
        onSortChange={c.handleSortChange}
        // Lock the toggle during a load so rapid taps don't queue concurrent
        // fetches (the latest would still win, but it wastes reads + flickers).
        disabled={c.loading}
        position={c.visibleClips.length > 0 ? { index: c.safeIndex, total: c.visibleClips.length } : undefined}
        onPostClip={() => setUploadOpen(true)}
      />

      {c.error && !c.loading && <ClipsFeedError error={c.error} errorCode={c.errorCode} onRetry={c.loadPool} />}

      {c.loading && <ClipsFeedSkeleton />}

      {!c.loading &&
        !c.error &&
        !currentClip &&
        (c.exhausted ? <ClipsFeedExhausted onReload={c.loadPool} /> : <ClipsFeedEmpty />)}

      {!c.loading && currentClip && (
        <>
          <SpotlightCard
            clip={currentClip}
            isOwnClip={isOwnClip}
            vote={c.voteFor(currentClip.id)}
            voting={c.isVoting(currentClip.id)}
            onViewPlayer={onViewPlayer}
            onNext={c.handleNext}
            onUpvote={c.handleUpvote}
            onDownvote={c.handleDownvote}
            onChallenge={onChallengeUser}
            onReport={setReportTarget}
            onComments={setCommentsTarget}
          />
          {/* Warm the cache for the upcoming clip while the current one
              plays — NEXT TRICK feels instant when the bytes are already
              local. Gated on Data-Saver / 2g inside the prefetcher. */}
          <NextClipPrefetcher src={nextClip?.videoUrl ?? null} />
        </>
      )}

      {/* Report modal — lazy-loaded; null fallback is fine because this
          subtree only mounts after the viewer has explicitly tapped REPORT. */}
      {/* Comment sheet — keyed on the clip so switching clips can never show
          one clip's thread against another's header. */}
      {commentsTarget && (
        <Suspense fallback={null}>
          <ClipComments
            key={commentsTarget.id}
            clip={commentsTarget}
            viewerUid={profile.uid}
            viewerUsername={profile.username}
            onClose={() => setCommentsTarget(null)}
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
              // Reload so the skater's clip is actually in the pool they're
              // looking at — "posted!" followed by an unchanged feed reads as
              // a failure.
              void c.loadPool();
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
              c.dismissClip(reportTarget.id);
              setReportTarget(null);
            }}
          />
        </Suspense>
      )}
    </section>
  );
}
