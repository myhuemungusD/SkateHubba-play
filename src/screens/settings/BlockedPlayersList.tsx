import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { UserProfile } from "../../services/users";
import { getUserProfile } from "../../services/users";
import { ProUsername } from "../../components/ProUsername";

/* ── Blocked players list ───────────────────────────────── */

export function BlockedPlayersList({
  currentUserUid,
  blockedUids,
  onUnblock,
}: {
  currentUserUid: string;
  blockedUids: Set<string>;
  onUnblock: (uid: string) => Promise<void>;
}) {
  // Hydrate blocked profiles so the list shows @usernames rather than raw uids.
  // Cache stores `UserProfile` for resolved users and `null` for UIDs the
  // server confirmed no longer exist (deleted accounts) — that distinction
  // is what lets the render path show "Deleted account" instead of a
  // forever-"Loading…" row. Absent keys (`uid in profiles === false`) mean
  // the fetch is still pending.
  const [profiles, setProfiles] = useState<Record<string, UserProfile | null>>({});
  // Latest-value mirror of `profiles` so the hydration effect doesn't list
  // `profiles` in its dep array — the effect *writes* to `profiles`, so a
  // straightforward dependency would loop. The mirror ref is updated in a
  // layout effect (which runs before the passive hydration effect below) and
  // read inside the effect body to skip already-hydrated UIDs.
  const profilesRef = useRef(profiles);
  useLayoutEffect(() => {
    profilesRef.current = profiles;
  }, [profiles]);
  // In-flight UIDs. Dedupes overlapping fetches when blockedUids changes mid-
  // hydration (e.g. an unblock happens while the initial batch is resolving).
  const pendingRef = useRef<Set<string>>(new Set());
  const [unblockingUid, setUnblockingUid] = useState<string | null>(null);
  const [unblockError, setUnblockError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Chunk the directory reads so a user who's blocked hundreds of people
    // doesn't fire hundreds of parallel Firestore reads on mount. Chunks of
    // 20 resolve fast enough that the UI still hydrates progressively, but
    // cheap enough that we won't hammer the quota or spike latency for
    // everyone else sharing the pool.
    const BATCH = 20;

    async function hydrate() {
      const current = profilesRef.current;
      const missing = Array.from(blockedUids).filter((uid) => !(uid in current) && !pendingRef.current.has(uid));
      for (let i = 0; i < missing.length && !cancelled; i += BATCH) {
        const chunk = missing.slice(i, i + BATCH);
        for (const uid of chunk) pendingRef.current.add(uid);
        const results = await Promise.all(
          chunk.map((uid) =>
            getUserProfile(uid)
              .then((p) => [uid, p] as const)
              // Treat a read failure the same as "not found" so the row
              // renders its deleted-account fallback instead of getting
              // stuck pending forever. The actual network error is logged
              // by getUserProfile itself.
              .catch(() => [uid, null] as const),
          ),
        );
        if (cancelled) return;
        setProfiles((prev) => {
          const next = { ...prev };
          for (const [uid, p] of results) {
            next[uid] = p;
            pendingRef.current.delete(uid);
          }
          return next;
        });
      }
    }

    void hydrate();
    return () => {
      cancelled = true;
      // Don't clear pendingRef on cleanup — a later re-run should still
      // dedupe against any fetches whose state updates already committed.
    };
  }, [blockedUids]);

  // Drop cached profiles the user has since unblocked — keeps the cache from
  // growing across the session. The state prune happens during render when
  // `blockedUids` changes (React's "adjust state when a prop changes"
  // pattern); the pendingRef prune stays in an effect so an unblock cancels
  // the in-flight dedupe for that UID.
  const [prunedFor, setPrunedFor] = useState(blockedUids);
  if (prunedFor !== blockedUids) {
    setPrunedFor(blockedUids);
    setProfiles((prev) => {
      let changed = false;
      const next: Record<string, UserProfile | null> = {};
      for (const [uid, p] of Object.entries(prev)) {
        if (blockedUids.has(uid)) next[uid] = p;
        else changed = true;
      }
      return changed ? next : prev;
    });
  }
  useEffect(() => {
    for (const uid of Array.from(pendingRef.current)) {
      if (!blockedUids.has(uid)) pendingRef.current.delete(uid);
    }
  }, [blockedUids]);

  const handleUnblock = useCallback(
    async (uid: string) => {
      setUnblockingUid(uid);
      setUnblockError(null);
      try {
        await onUnblock(uid);
      } catch (err) {
        setUnblockError(err instanceof Error ? err.message : "Failed to unblock");
      } finally {
        setUnblockingUid(null);
      }
    },
    [onUnblock],
  );

  if (blockedUids.size === 0) {
    return (
      <div className="flex flex-col items-center py-8 px-4 text-center">
        <p className="font-body text-xs text-faint">No blocked players</p>
        <p className="font-body text-label text-subtle mt-1 max-w-[18rem]">
          Blocks hide a user&apos;s clips and prevent them from challenging you. Unblock them from here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {unblockError && (
        <p role="alert" className="font-body text-xs text-brand-red p-4">
          {unblockError}
        </p>
      )}
      {Array.from(blockedUids).map((uid) => {
        // Self-unblock guard should never trigger (UIDs are distinct by
        // definition); keep the check so a badly-seeded Set can't brick the row.
        if (uid === currentUserUid) return null;
        // Three render states: key absent = still fetching; value null =
        // server confirmed the account is gone (deleted, purged for policy
        // violation, etc.); UserProfile = normal display.
        const resolved = uid in profiles;
        const profile = resolved ? profiles[uid] : undefined;
        const isUnblocking = unblockingUid === uid;
        return (
          <div key={uid} className="flex items-center justify-between p-4 rounded-2xl glass-card">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-surface-alt border border-border flex items-center justify-center shrink-0">
                <span className="font-display text-sm text-brand-orange leading-none">
                  {profile ? profile.username[0].toUpperCase() : resolved ? "?" : "•"}
                </span>
              </div>
              <div className="min-w-0">
                {profile ? (
                  <ProUsername
                    username={profile.username}
                    isVerifiedPro={profile.isVerifiedPro}
                    className="font-display text-base text-white block leading-none truncate"
                  />
                ) : resolved ? (
                  <span className="font-display text-sm text-subtle block leading-none">Deleted account</span>
                ) : (
                  <span className="font-body text-sm text-subtle">Loading…</span>
                )}
                <span className="font-body text-label text-faint block mt-1">Blocked</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleUnblock(uid)}
              disabled={isUnblocking}
              className="min-h-[44px] inline-flex items-center justify-center font-display text-sm text-muted border border-border hover:text-white hover:border-border-hover hover:bg-white/[0.02] transition-all px-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-50"
            >
              {isUnblocking ? "..." : "Unblock"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
