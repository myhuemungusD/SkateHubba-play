import { useCallback, useEffect, useRef, useState } from "react";
import type { UserProfile } from "../services/users";
import { getUserProfile } from "../services/users";
import { unblockUser } from "../services/blocking";
import { useBlockedUsers } from "../hooks/useBlockedUsers";
import { isHapticsEnabled, setHapticsEnabled, playHaptic } from "../services/haptics";
import { useNotifications } from "../context/NotificationContext";
import { requestPushPermission } from "../services/fcm";
import { logger } from "../services/logger";
import { Btn } from "../components/ui/Btn";
import { ProUsername } from "../components/ProUsername";
import { ChevronLeftIcon } from "../components/icons";

type PushState = "unsupported" | "default" | "granted" | "denied";

/** Permission values the Notifications API spec defines. Anything outside
 *  this set (a future expansion, a non-standard browser, a misconfigured
 *  polyfill) degrades to "unsupported" rather than flowing a bogus string
 *  through the UI branches below. */
const KNOWN_PUSH_STATES: ReadonlySet<string> = new Set<PushState>(["default", "granted", "denied"]);

function readPushState(): PushState {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  const perm: unknown = Notification.permission;
  if (typeof perm !== "string" || !KNOWN_PUSH_STATES.has(perm)) return "unsupported";
  return perm as PushState;
}

/* ── Preference row primitive ───────────────────────────── */

interface PrefRowProps {
  title: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  trailing?: React.ReactNode;
}

function PrefRow({ title, description, checked, onChange, disabled, trailing }: PrefRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-2xl glass-card">
      <div className="min-w-0">
        <p className="font-display text-sm text-white tracking-wide">{title}</p>
        <p className="font-body text-xs text-faint mt-1 leading-snug">{description}</p>
        {trailing && <div className="mt-2">{trailing}</div>}
      </div>
      {/* Outer button is the 44pt tap target (iOS HIG / Material Design
          minimum); the visually compact pill lives in an inner span so the
          design stays tight while the accessible hit area extends past it.
          Switch semantics (role, aria-checked, label) stay on the button so
          assistive tech still identifies this as a toggle. */}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        onClick={() => onChange(!checked)}
        disabled={disabled}
        className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-40 disabled:cursor-not-allowed"
      >
        <span
          aria-hidden="true"
          className={`relative inline-flex h-7 w-12 items-center rounded-full border transition-all duration-300 ${
            checked
              ? "bg-brand-orange/25 border-brand-orange/60 shadow-[0_0_8px_rgba(255,107,0,0.2)]"
              : "bg-surface-alt border-border"
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-300 ${
              checked ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </span>
      </button>
    </div>
  );
}

/* ── Section header ─────────────────────────────────────── */

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-8 first:mt-0">
      <h2 className="font-display text-[11px] tracking-[0.2em] text-brand-orange">{title}</h2>
      {typeof count === "number" && (
        <span className="px-1.5 py-0.5 rounded bg-surface-alt border border-border font-display text-[10px] text-brand-orange leading-none tabular-nums">
          {count}
        </span>
      )}
    </div>
  );
}

/* ── Blocked players list ───────────────────────────────── */

function BlockedPlayersList({
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
  // straightforward dependency would loop. The mirror ref is updated during
  // commit and read inside the effect body to skip already-hydrated UIDs.
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
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
  // growing across the session. Prune pendingRef too so an unblock cancels
  // the in-flight dedupe for that UID.
  useEffect(() => {
    setProfiles((prev) => {
      let changed = false;
      const next: Record<string, UserProfile | null> = {};
      for (const [uid, p] of Object.entries(prev)) {
        if (blockedUids.has(uid)) next[uid] = p;
        else changed = true;
      }
      return changed ? next : prev;
    });
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
      <div className="flex flex-col items-center py-8 border border-dashed border-white/[0.06] rounded-2xl bg-surface/30 backdrop-blur-sm text-center">
        <p className="font-body text-xs text-faint">No blocked players</p>
        <p className="font-body text-[11px] text-subtle mt-1 max-w-[18rem]">
          Blocks hide a user&apos;s clips and prevent them from challenging you. Unblock them from here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {unblockError && (
        <p role="alert" className="font-body text-xs text-brand-red px-1">
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
                <span className="font-display text-[11px] text-brand-orange leading-none">
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
                <span className="font-body text-[11px] text-faint block mt-1">Blocked</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleUnblock(uid)}
              disabled={isUnblocking}
              className="min-h-[44px] inline-flex items-center justify-center font-display text-xs text-muted border border-border hover:text-white hover:border-border-hover hover:bg-white/[0.02] transition-all px-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-50"
            >
              {isUnblocking ? "..." : "Unblock"}
            </button>
          </div>
        );
      })}
    </div>
  );
}

/* ── Main Settings screen ───────────────────────────────── */

export function Settings({ profile, onBack }: { profile: UserProfile; onBack: () => void }) {
  const { soundEnabled, toggleSound } = useNotifications();

  // Haptic preference — local state mirrors the localStorage-backed service
  // flag so the switch renders synchronously without a read-through on every
  // tick. On toggle we fire the relevant haptic (only when turning on) so the
  // user feels the preference take effect.
  const [haptics, setHaptics] = useState<boolean>(() => isHapticsEnabled());

  const handleToggleHaptics = useCallback((next: boolean) => {
    setHaptics(next);
    setHapticsEnabled(next);
    if (next) playHaptic("button_primary");
  }, []);

  // Push permission is a tri-state that only transitions via browser
  // prompts — we read once on mount and refresh after a user-initiated
  // enable. `unsupported` fires on desktop Safari + older browsers.
  const [pushState, setPushState] = useState<PushState>(readPushState);
  const [requestingPush, setRequestingPush] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);

  const handleEnablePush = useCallback(async () => {
    setRequestingPush(true);
    setPushError(null);
    try {
      const token = await requestPushPermission(profile.uid);
      const next = readPushState();
      setPushState(next);
      if (!token && next === "denied") {
        setPushError("Notifications were blocked. Enable them in system settings and try again.");
      } else if (!token) {
        setPushError("Couldn't enable notifications. Please try again.");
      }
    } catch (err) {
      logger.warn("settings_push_request_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      setPushError("Something went wrong. Please try again.");
    } finally {
      setRequestingPush(false);
    }
  }, [profile.uid]);

  const blockedUids = useBlockedUsers(profile.uid);

  const handleUnblock = useCallback(
    async (uid: string) => {
      await unblockUser(profile.uid, uid);
    },
    [profile.uid],
  );

  const supportEmail = "support@skatehubba.com";
  const feedbackSubject = encodeURIComponent("SkateHubba feedback");
  const bugSubject = encodeURIComponent(`SkateHubba bug report — @${profile.username}`);

  return (
    <div className="min-h-dvh pb-24 overflow-y-auto bg-[#0A0A0A]/80">
      {/* Header */}
      <div className="px-5 pt-safe pb-4 flex justify-between items-center border-b border-white/[0.04] glass">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-2 touch-target text-muted hover:text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange rounded-lg"
          aria-label="Back to lobby"
        >
          <ChevronLeftIcon size={16} />
          <span className="font-body text-xs">Lobby</span>
        </button>
        <img
          src="/logonew.webp"
          alt=""
          draggable={false}
          className="h-5 w-auto select-none opacity-40"
          aria-hidden="true"
        />
        <div className="w-16" aria-hidden="true" />
      </div>

      <div className="px-5 pt-7 max-w-lg mx-auto">
        <h1 className="font-display text-fluid-4xl text-white mb-2 tracking-wide">Settings</h1>
        <p className="font-body text-sm text-muted mb-6">Notifications, sound, haptics, and blocked players.</p>

        {/* Notifications */}
        <SectionHeader title="NOTIFICATIONS" />
        <div className="space-y-2">
          {pushState === "unsupported" && (
            <div className="p-4 rounded-2xl border border-dashed border-border bg-surface/30 backdrop-blur-sm">
              <p className="font-body text-xs text-faint">
                Push notifications aren&apos;t supported in this browser. Use a recent version of Chrome, Safari, or
                Firefox — or install SkateHubba to your home screen.
              </p>
            </div>
          )}
          {pushState === "granted" && (
            <div className="flex items-center gap-3 p-4 rounded-2xl glass-card">
              <span
                className="w-2 h-2 rounded-full bg-brand-green shadow-[0_0_8px_rgba(0,230,118,0.5)]"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="font-display text-sm text-white">Push notifications on</p>
                <p className="font-body text-xs text-faint mt-1">
                  You&apos;ll hear from us when it&apos;s your turn, when you&apos;re challenged, and when a game ends.
                </p>
              </div>
            </div>
          )}
          {pushState === "default" && (
            <div className="p-4 rounded-2xl glass-card">
              <p className="font-display text-sm text-white mb-1">Enable push notifications</p>
              <p className="font-body text-xs text-faint mb-3">
                Get notified the moment it&apos;s your turn. You can turn this off any time in your browser or system
                settings.
              </p>
              <Btn variant="secondary" onClick={handleEnablePush} disabled={requestingPush}>
                {requestingPush ? "Enabling…" : "Enable Notifications"}
              </Btn>
              {pushError && (
                <p role="alert" className="font-body text-xs text-brand-red mt-2">
                  {pushError}
                </p>
              )}
            </div>
          )}
          {pushState === "denied" && (
            <div className="p-4 rounded-2xl border border-brand-red/25 bg-brand-red/[0.06]">
              <p className="font-display text-sm text-white mb-1">Notifications blocked</p>
              <p className="font-body text-xs text-faint">
                You&apos;ve blocked SkateHubba from sending notifications. Re-enable them from your browser or system
                settings, then reload this page.
              </p>
            </div>
          )}
        </div>

        {/* Sound & haptics */}
        <SectionHeader title="FEEDBACK" />
        <div className="space-y-2">
          <PrefRow
            title="Sound effects"
            description="Short chimes when it's your turn, on wins, and on challenges."
            checked={soundEnabled}
            onChange={toggleSound}
          />
          <PrefRow
            title="Haptics"
            description="Taptic feedback on button presses, wins, and nudges (native only)."
            checked={haptics}
            onChange={handleToggleHaptics}
          />
        </div>

        {/* Blocked players */}
        <SectionHeader title="BLOCKED PLAYERS" count={blockedUids.size} />
        <BlockedPlayersList currentUserUid={profile.uid} blockedUids={blockedUids} onUnblock={handleUnblock} />

        {/* Help & support */}
        <SectionHeader title="HELP & SUPPORT" />
        <div className="space-y-2">
          <a
            href={`mailto:${supportEmail}?subject=${bugSubject}`}
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Report a bug</p>
            <p className="font-body text-xs text-faint mt-1">Email our team — include a screenshot if you can.</p>
          </a>
          <a
            href={`mailto:${supportEmail}?subject=${feedbackSubject}`}
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Send feedback</p>
            <p className="font-body text-xs text-faint mt-1">Tell us what you&apos;d like to see in the app.</p>
          </a>
        </div>

        {/* Legal */}
        <SectionHeader title="LEGAL" />
        <div className="space-y-2">
          <a
            href="/privacy"
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Privacy Policy</p>
          </a>
          <a
            href="/terms"
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Terms of Service</p>
          </a>
          <a
            href="/data-deletion"
            className="block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <p className="font-display text-sm text-white tracking-wide">Data Deletion</p>
          </a>
        </div>

        {/* Brand watermark */}
        <div className="brand-watermark mt-10">
          <div className="brand-divider flex-1 max-w-16" />
          <img src="/logonew.webp" alt="" draggable={false} className="h-4 w-auto select-none" aria-hidden="true" />
          <div className="brand-divider flex-1 max-w-16" />
        </div>
      </div>
    </div>
  );
}
