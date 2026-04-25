import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlreadyUpvotedError,
  fetchClipUpvoteState,
  fetchRandomLandedClips,
  upvoteClip,
  type ClipDoc,
  type ClipUpvoteState,
} from "../../services/clips";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";
import { useBlockedUsers } from "../../hooks/useBlockedUsers";

export const SAMPLE_SIZE = 12;
export const POOL_SIZE = 60;

/** Firestore error codes that map to "service-side issue, not your network". */
export const SERVICE_ERROR_CODES = new Set(["permission-denied", "failed-precondition", "unauthenticated"]);

export function errorCodeFor(err: unknown): string | undefined {
  return typeof err === "object" && err && typeof (err as { code?: unknown }).code === "string"
    ? (err as { code: string }).code
    : undefined;
}

function copyForError(code: string | undefined): string {
  if (code && SERVICE_ERROR_CODES.has(code)) {
    return "Feed temporarily unavailable — please try again in a moment.";
  }
  return "Couldn't load the feed. Check your connection and try again.";
}

/** Human-readable "2m ago" / "3h ago" / "Apr 12" timestamp. */
export function relativeClipTime(createdAt: ClipDoc["createdAt"]): string {
  if (!createdAt || typeof createdAt.toMillis !== "function") return "";
  const millis = createdAt.toMillis();
  const deltaMs = Date.now() - millis;
  if (deltaMs < 0) return "just now";
  const minutes = deltaMs / 60_000;
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${Math.floor(minutes)}m ago`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  const days = hours / 24;
  if (days < 7) return `${Math.floor(days)}d ago`;
  const d = new Date(millis);
  const month = d.toLocaleString("en-US", { month: "short" });
  return `${month} ${d.getDate()}`;
}

export interface UseClipsFeedResult {
  loading: boolean;
  error: string | null;
  errorCode: string | null;
  visibleClips: readonly ClipDoc[];
  currentClip: ClipDoc | undefined;
  safeIndex: number;
  isOwnClip: boolean;
  upvote: ClipUpvoteState;
  upvoteDisabled: boolean;
  reportTarget: ClipDoc | null;
  loadPool: () => Promise<void>;
  handleNext: () => void;
  handleUpvote: (clip: ClipDoc) => Promise<void>;
  openReport: (clip: ClipDoc) => void;
  closeReport: () => void;
  markReported: (clipId: string) => void;
}

/**
 * Controller hook for the community clips spotlight.
 *
 * Owns: pool fetch + sampling, optimistic upvotes with race-guarded hydration,
 * client-side filtering of blocked users + reported clips, and the "Next Trick"
 * exhaustion-triggered refetch. Pure logic — renders nothing.
 */
export function useClipsFeed(viewerUid: string): UseClipsFeedResult {
  const [pool, setPool] = useState<ClipDoc[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [reportTarget, setReportTarget] = useState<ClipDoc | null>(null);
  const [reportedClipIds, setReportedClipIds] = useState<ReadonlySet<string>>(new Set());
  const [upvoteState, setUpvoteState] = useState<ReadonlyMap<string, ClipUpvoteState>>(new Map());
  const [upvotingIds, setUpvotingIds] = useState<ReadonlySet<string>>(new Set());

  const blockedUids = useBlockedUsers(viewerUid);

  // Guard against setState-after-unmount during fetch races.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Mirror `upvotingIds` in a ref so hydration can see it without being
  // re-memoized on every tap (which would retrigger hydration).
  const upvotingIdsRef = useRef<ReadonlySet<string>>(upvotingIds);
  useEffect(() => {
    upvotingIdsRef.current = upvotingIds;
  }, [upvotingIds]);

  // Hydrate upvote state for a freshly-loaded pool. Best-effort: failures
  // leave entries missing (UI defaults to count=0, not-upvoted). Own clips
  // are skipped because self-upvote is disallowed.
  const hydrateUpvotes = useCallback(
    async (pageClips: readonly ClipDoc[]) => {
      const ids = pageClips.filter((c) => c.playerUid !== viewerUid).map((c) => c.id);
      if (ids.length === 0) return;
      try {
        const map = await fetchClipUpvoteState(viewerUid, ids);
        if (!mountedRef.current) return;
        setUpvoteState((prev) => {
          const next = new Map(prev);
          for (const [id, state] of map) {
            // Race guard: don't clobber an optimistic upvote with the
            // pre-vote hydrated snapshot.
            const existing = prev.get(id);
            if (existing?.alreadyUpvoted || upvotingIdsRef.current.has(id)) continue;
            next.set(id, state);
          }
          return next;
        });
      } catch (err) {
        logger.warn("clips_feed_upvote_hydrate_failed", { error: parseFirebaseError(err) });
      }
    },
    [viewerUid],
  );

  const loadPool = useCallback(async () => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const fresh = await fetchRandomLandedClips(SAMPLE_SIZE, POOL_SIZE);
      if (!mountedRef.current) return;
      setPool(fresh);
      setCurrentIndex(0);
      // Hydration is fire-and-forget — spotlight renders immediately,
      // upvote counts pop in once the batch resolves.
      void hydrateUpvotes(fresh);
    } catch (err) {
      const code = errorCodeFor(err);
      logger.warn("clips_feed_load_failed", { code, error: parseFirebaseError(err) });
      if (mountedRef.current) {
        setError(copyForError(code));
        setErrorCode(code ?? null);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [hydrateUpvotes]);

  useEffect(() => {
    loadPool();
  }, [loadPool]);

  // Filter blocked users + reported clips out on the client.
  const visibleClips = useMemo(
    () => pool.filter((c) => !blockedUids.has(c.playerUid) && !reportedClipIds.has(c.id)),
    [pool, blockedUids, reportedClipIds],
  );

  const safeIndex = visibleClips.length === 0 ? 0 : Math.min(currentIndex, visibleClips.length - 1);
  const currentClip = visibleClips[safeIndex];

  const handleNext = useCallback(() => {
    if (safeIndex + 1 >= visibleClips.length) {
      // Pool exhausted — refetch + reshuffle.
      void loadPool();
      return;
    }
    setCurrentIndex(safeIndex + 1);
  }, [safeIndex, visibleClips.length, loadPool]);

  const handleUpvote = useCallback(
    async (clip: ClipDoc) => {
      if (clip.playerUid === viewerUid) return;
      const current = upvoteState.get(clip.id) ?? { count: 0, alreadyUpvoted: false };
      if (current.alreadyUpvoted || upvotingIds.has(clip.id)) return;

      setUpvotingIds((prev) => {
        const next = new Set(prev);
        next.add(clip.id);
        return next;
      });
      setUpvoteState((prev) => {
        const next = new Map(prev);
        next.set(clip.id, { count: current.count + 1, alreadyUpvoted: true });
        return next;
      });

      try {
        const nextCount = await upvoteClip(viewerUid, clip.id);
        if (!mountedRef.current) return;
        setUpvoteState((prev) => {
          const next = new Map(prev);
          next.set(clip.id, { count: nextCount, alreadyUpvoted: true });
          return next;
        });
      } catch (err) {
        if (err instanceof AlreadyUpvotedError) return;
        logger.warn("clips_feed_upvote_failed", { clipId: clip.id, error: parseFirebaseError(err) });
        if (!mountedRef.current) return;
        setUpvoteState((prev) => {
          const next = new Map(prev);
          next.set(clip.id, current);
          return next;
        });
      } finally {
        if (mountedRef.current) {
          setUpvotingIds((prev) => {
            const next = new Set(prev);
            next.delete(clip.id);
            return next;
          });
        }
      }
    },
    [viewerUid, upvoteState, upvotingIds],
  );

  const openReport = useCallback((clip: ClipDoc) => setReportTarget(clip), []);
  const closeReport = useCallback(() => setReportTarget(null), []);
  const markReported = useCallback((clipId: string) => {
    setReportedClipIds((prev) => {
      const next = new Set(prev);
      next.add(clipId);
      return next;
    });
  }, []);

  const isOwnClip = currentClip ? currentClip.playerUid === viewerUid : false;
  const upvote: ClipUpvoteState = currentClip
    ? (upvoteState.get(currentClip.id) ?? { count: 0, alreadyUpvoted: false })
    : { count: 0, alreadyUpvoted: false };
  const isUpvoting = currentClip ? upvotingIds.has(currentClip.id) : false;
  const upvoteDisabled = isOwnClip || upvote.alreadyUpvoted || isUpvoting;

  return {
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
  };
}
