import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchClipsFeed, type ClipDoc, type ClipsFeedCursor } from "../services/clips";
import { logger } from "../services/logger";
import { useBlockedUsers } from "../hooks/useBlockedUsers";
import { ReportModal } from "../components/ReportModal";
import { Btn } from "../components/ui/Btn";
import { FilmIcon, ChevronRightIcon, FlagIcon } from "../components/icons";
import { ProUsername } from "../components/ProUsername";
import type { UserProfile } from "../services/users";

const PAGE_SIZE = 12;

/** Human-readable "2m ago" / "3h ago" / "Apr 12" timestamp. */
function relativeClipTime(createdAt: ClipDoc["createdAt"]): string {
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

export interface ClipsScreenProps {
  profile: UserProfile;
  /** Navigate to a player's public profile. */
  onViewPlayer: (uid: string) => void;
  /** Kick off a challenge flow against a username — used by the "Challenge" CTA. */
  onChallengeUser: (username: string) => void;
}

export function ClipsScreen({ profile, onViewPlayer, onChallengeUser }: ClipsScreenProps) {
  const [clips, setClips] = useState<ClipDoc[]>([]);
  const [cursor, setCursor] = useState<ClipsFeedCursor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [endOfFeed, setEndOfFeed] = useState(false);
  const [reportTarget, setReportTarget] = useState<ClipDoc | null>(null);
  const [reportedClipIds, setReportedClipIds] = useState<ReadonlySet<string>>(new Set());

  const blockedUids = useBlockedUsers(profile.uid);

  // Guard against setState-after-unmount during pagination races.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadFirstPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchClipsFeed(null, PAGE_SIZE);
      if (!mountedRef.current) return;
      setClips(page.clips);
      setCursor(page.cursor);
      setEndOfFeed(page.clips.length < PAGE_SIZE);
    } catch (err) {
      logger.warn("clips_feed_load_failed", { error: err instanceof Error ? err.message : String(err) });
      if (mountedRef.current) setError("Couldn't load the feed. Check your connection and try again.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFirstPage();
  }, [loadFirstPage]);

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore || endOfFeed) return;
    setLoadingMore(true);
    try {
      const page = await fetchClipsFeed(cursor, PAGE_SIZE);
      if (!mountedRef.current) return;
      setClips((prev) => [...prev, ...page.clips]);
      setCursor(page.cursor);
      if (page.clips.length < PAGE_SIZE) setEndOfFeed(true);
    } catch (err) {
      logger.warn("clips_feed_loadmore_failed", { error: err instanceof Error ? err.message : String(err) });
    } finally {
      if (mountedRef.current) setLoadingMore(false);
    }
  }, [cursor, loadingMore, endOfFeed]);

  // Filter blocked users out on the client (matches how games/directory work).
  const visibleClips = useMemo(
    () => clips.filter((c) => !blockedUids.has(c.playerUid) && !reportedClipIds.has(c.id)),
    [clips, blockedUids, reportedClipIds],
  );

  const myUid = profile.uid;

  return (
    <div className="min-h-dvh bg-[#0A0A0A]/40 pb-28">
      {/* Page header — matches Lobby's Bebas Neue title + accent subtitle */}
      <div className="px-5 pt-7 max-w-lg mx-auto">
        <div className="mb-6">
          <h1 className="font-display text-fluid-4xl leading-none text-white tracking-wide">Feed</h1>
          <p className="font-body text-xs text-brand-green mt-1.5">Landed tricks from the community</p>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="glass-card rounded-2xl p-5 mb-6 border border-brand-red/30">
            <p className="font-body text-sm text-white/80 mb-3">{error}</p>
            <Btn onClick={loadFirstPage} variant="secondary">
              Try again
            </Btn>
          </div>
        )}

        {/* Loading (first page) */}
        {loading && (
          <div className="flex flex-col items-center py-14" role="status" aria-label="Loading clips">
            <div className="relative w-12 h-12 mb-4">
              <div className="absolute inset-0 rounded-full border-2 border-border" />
              <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-brand-orange animate-spin" />
            </div>
            <p className="font-body text-xs text-faint">Loading feed…</p>
          </div>
        )}

        {/* Empty */}
        {!loading && !error && visibleClips.length === 0 && (
          <div className="flex flex-col items-center py-14 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30">
            <FilmIcon size={28} className="mb-4 opacity-40 text-subtle" />
            <p className="font-body text-sm text-dim">No clips yet.</p>
            <p className="font-body text-xs text-faint mt-1">Land a trick to start filling the feed.</p>
          </div>
        )}

        {/* Clips list */}
        {!loading && visibleClips.length > 0 && (
          <ul className="space-y-4" aria-label="Clips feed">
            {visibleClips.map((clip) => (
              <li key={clip.id} className="glass-card rounded-2xl overflow-hidden">
                {/* Top meta row: player + time + role badge */}
                <div className="flex items-center justify-between px-4 pt-3.5 pb-3">
                  <button
                    type="button"
                    onClick={() => onViewPlayer(clip.playerUid)}
                    className="flex items-center gap-2 rounded-xl px-1.5 py-1 -ml-1.5 hover:bg-white/[0.03] transition-colors duration-200 group"
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

                {/* Video */}
                <div className="px-4">
                  <video
                    src={clip.videoUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full aspect-[9/16] max-h-[560px] rounded-xl bg-black object-cover border border-border"
                  />
                </div>

                {/* Trick name */}
                <div className="px-4 pt-3">
                  <h2 className="font-display text-xl text-white tracking-wide leading-tight">{clip.trickName}</h2>
                </div>

                {/* Actions */}
                <div className="px-4 pt-3 pb-4 flex items-center gap-2">
                  {clip.playerUid !== myUid && (
                    <button
                      type="button"
                      onClick={() => onChallengeUser(clip.playerUsername)}
                      className="flex-1 flex items-center justify-center gap-1.5 rounded-xl py-2.5 font-display text-sm tracking-wider bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white active:scale-[0.97] hover:-translate-y-0.5 transition-all duration-300 shadow-[0_2px_12px_rgba(255,107,0,0.18)] ring-1 ring-white/[0.08]"
                    >
                      <span>Challenge</span>
                      <ChevronRightIcon size={14} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setReportTarget(clip)}
                    disabled={clip.playerUid === myUid}
                    aria-label={`Report clip by @${clip.playerUsername}`}
                    className="flex items-center justify-center gap-1.5 rounded-xl px-3.5 py-2.5 font-display text-[11px] tracking-[0.15em] text-faint border border-border hover:text-white hover:border-border-hover hover:bg-white/[0.02] disabled:opacity-30 disabled:cursor-not-allowed transition-all duration-300"
                  >
                    <FlagIcon size={13} />
                    REPORT
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Pagination */}
        {!loading && visibleClips.length > 0 && !endOfFeed && (
          <div className="mt-6">
            <Btn onClick={loadMore} variant="secondary" disabled={loadingMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </Btn>
          </div>
        )}

        {!loading && visibleClips.length > 0 && endOfFeed && (
          <p className="font-body text-xs text-faint text-center mt-6">You're all caught up.</p>
        )}
      </div>

      {/* Report modal */}
      {reportTarget && (
        <ReportModal
          reporterUid={profile.uid}
          reportedUid={reportTarget.playerUid}
          reportedUsername={reportTarget.playerUsername}
          gameId={reportTarget.gameId}
          clipId={reportTarget.id}
          onClose={() => setReportTarget(null)}
          onSubmitted={() => {
            const reportedId = reportTarget.id;
            setReportedClipIds((prev) => {
              const next = new Set(prev);
              next.add(reportedId);
              return next;
            });
            setReportTarget(null);
          }}
        />
      )}
    </div>
  );
}
