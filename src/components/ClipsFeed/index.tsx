import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import type { ClipDoc } from "../../services/clips";
import type { GameDoc } from "../../services/games";
import { judgeRuleSetTrick, resolveDispute } from "../../services/games";
import { trackEvent } from "../../services/analytics";
import { logger } from "../../services/logger";
import { captureException } from "../../lib/sentry";
import { parseFirebaseError } from "../../utils/helpers";
import type { UserProfile } from "../../services/users";

// ReportModal pulls in submitReport + REPORT_REASON_LABELS + useFocusTrap +
// the modal's own UI primitives. It only ever renders when a viewer taps
// REPORT — a rare interaction. Lazy-load it so the lobby's critical
// bundle skips the form code entirely. Suspense fallback is null because
// the modal is already state-gated; the brief import delay (~50ms on
// warm cache) happens AFTER the user has tapped, so it's invisible.
const ReportModal = lazy(() => import("../ReportModal").then((m) => ({ default: m.ReportModal })));
import { ClipsFeedEmpty, ClipsFeedError, ClipsFeedExhausted, ClipsFeedSkeleton } from "./ClipsFeedStates";
import { ClipsFeedHeader } from "./ClipsFeedHeader";
import { NextClipPrefetcher } from "./NextClipPrefetcher";
import { RulingCard } from "./RulingCard";
import { SpotlightCard } from "./SpotlightCard";
import { selectPendingRulings, type PendingRuling } from "./pendingRulings";
import { useClipsFeedController } from "./useClipsFeedController";

export interface ClipsFeedProps {
  profile: UserProfile;
  /**
   * The viewer's games, straight from the lobby subscription (which already
   * merges the judge slice). Used to derive the ruling lane without a
   * second listener. Optional so the feed degrades to clips-only if a
   * caller has no game context.
   */
  games?: readonly GameDoc[];
  /** Navigate to a player's public profile. */
  onViewPlayer: (uid: string) => void;
  /** Kick off a challenge flow against a username — used by the "Challenge" CTA. */
  onChallengeUser: (username: string) => void;
  /** Open the full game screen for a disputed turn. */
  onOpenGame?: (gameId: string) => void;
}

/**
 * The lobby feed. Two lanes, in priority order:
 *
 *  1. **Rulings** — disputes waiting on THIS viewer as the nominated referee
 *     (`disputable`: did the matcher land it? / `setReview`: was the set
 *     clean?). Both videos play inline and the call is cast without leaving
 *     the lobby; the ruling routes through the same transactional services
 *     the game screen uses. Derived from the games the lobby already
 *     subscribes to, so the lane costs no extra reads and clears itself on
 *     the next snapshot.
 *
 *  2. **Community clips** — landed tricks from across the app, one at a time,
 *     ordered by `sort` (Top: `upvoteCount` desc; New: reverse-chrono).
 *     Thumbs up records a vote; thumbs down withdraws yours (if any) and
 *     passes the clip for the session. Challenge and report sit alongside.
 */
export function ClipsFeed({ profile, games, onViewPlayer, onChallengeUser, onOpenGame }: ClipsFeedProps) {
  const c = useClipsFeedController(profile.uid);

  const [reportTarget, setReportTarget] = useState<ClipDoc | null>(null);
  // Games ruled on in this session. The snapshot drops them from the lane a
  // beat later; this hides the card immediately so a decisive second tap
  // can't land on a stale card.
  const [ruledGameIds, setRuledGameIds] = useState<ReadonlySet<string>>(new Set());
  const [rulingGameId, setRulingGameId] = useState<string | null>(null);
  const [rulingError, setRulingError] = useState<{ gameId: string; message: string } | null>(null);
  const rulingInFlightRef = useRef(false);

  const rulings = useMemo(() => {
    if (!games || games.length === 0) return [];
    return selectPendingRulings(games, profile.uid, Date.now()).filter((r) => !ruledGameIds.has(r.gameId));
  }, [games, profile.uid, ruledGameIds]);

  const handleRule = useCallback(async (ruling: PendingRuling, accept: boolean) => {
    // Ruling is a game-state mutation; a double-tap must never fire two
    // transactions. The ref latches synchronously, ahead of any re-render.
    if (rulingInFlightRef.current) return;
    rulingInFlightRef.current = true;
    setRulingGameId(ruling.gameId);
    setRulingError(null);
    try {
      if (ruling.kind === "dispute") {
        await resolveDispute(ruling.gameId, accept);
      } else {
        await judgeRuleSetTrick(ruling.gameId, accept);
      }
      trackEvent("clip_ruling_cast", { gameId: ruling.gameId, kind: ruling.kind, accept, from: "feed" });
      setRuledGameIds((prev) => {
        const next = new Set(prev);
        next.add(ruling.gameId);
        return next;
      });
    } catch (err) {
      logger.warn("clips_feed_ruling_failed", { gameId: ruling.gameId, error: parseFirebaseError(err) });
      captureException(err, { extra: { context: "clipsFeedRuling", gameId: ruling.gameId, accept } });
      setRulingError({
        gameId: ruling.gameId,
        message: err instanceof Error ? err.message : "Couldn't submit your ruling — try again.",
      });
    } finally {
      rulingInFlightRef.current = false;
      setRulingGameId(null);
    }
  }, []);

  const handleOpenGame = useCallback((gameId: string) => onOpenGame?.(gameId), [onOpenGame]);

  const { currentClip, nextClip } = c;
  const isOwnClip = currentClip ? currentClip.playerUid === profile.uid : false;

  return (
    <section className="mb-6" aria-label="Community feed">
      {rulings.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-display text-[11px] tracking-[0.2em] text-amber-400">NEEDS YOUR CALL</h3>
            <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 font-display text-[10px] text-amber-400 leading-none tabular-nums">
              {rulings.length}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {rulings.map((ruling) => (
              <RulingCard
                key={ruling.gameId}
                ruling={ruling}
                submitting={rulingGameId === ruling.gameId}
                error={rulingError?.gameId === ruling.gameId ? rulingError.message : null}
                onRule={handleRule}
                onOpenGame={handleOpenGame}
              />
            ))}
          </div>
        </div>
      )}

      <ClipsFeedHeader
        sort={c.sort}
        onSortChange={c.handleSortChange}
        // Lock the toggle during a load so rapid taps don't queue concurrent
        // fetches (the latest would still win, but it wastes reads + flickers).
        disabled={c.loading}
        position={c.visibleClips.length > 0 ? { index: c.safeIndex, total: c.visibleClips.length } : undefined}
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
            upvote={c.upvoteFor(currentClip.id)}
            voting={c.isVoting(currentClip.id)}
            onViewPlayer={onViewPlayer}
            onNext={c.handleNext}
            onUpvote={c.handleUpvote}
            onDownvote={c.handleDownvote}
            onChallenge={onChallengeUser}
            onReport={setReportTarget}
          />
          {/* Warm the cache for the upcoming clip while the current one
              plays — NEXT TRICK feels instant when the bytes are already
              local. Gated on Data-Saver / 2g inside the prefetcher. */}
          <NextClipPrefetcher src={nextClip?.videoUrl ?? null} />
        </>
      )}

      {/* Report modal — lazy-loaded; null fallback is fine because this
          subtree only mounts after the viewer has explicitly tapped REPORT. */}
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
