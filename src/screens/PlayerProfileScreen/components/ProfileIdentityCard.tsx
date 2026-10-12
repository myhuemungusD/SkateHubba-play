import { useState } from "react";
import { AvatarImage } from "../../../components/AvatarImage";
import { ProUsername } from "../../../components/ProUsername";
import { AvatarPicker } from "../../../components/AvatarPicker";
import { LevelChip } from "../../../components/LevelChip";
import { xpProgress } from "../../../constants/xp";
import { isXpEnabled } from "../../../lib/featureFlags";
import { getAvatarFallbackUrl } from "../../../services/avatars";

const BAR_WIDTH = [
  "w-0",
  "w-[5%]",
  "w-[10%]",
  "w-[15%]",
  "w-[20%]",
  "w-[25%]",
  "w-[30%]",
  "w-[35%]",
  "w-[40%]",
  "w-[45%]",
  "w-[50%]",
  "w-[55%]",
  "w-[60%]",
  "w-[65%]",
  "w-[70%]",
  "w-[75%]",
  "w-[80%]",
  "w-[85%]",
  "w-[90%]",
  "w-[95%]",
  "w-full",
] as const;

/**
 * Identity card at the top of the profile (PR-C — full rewrite per plan §6.4).
 *
 * Visible changes from the pre-PR-C version:
 *   - Avatar grew from 56px (`w-14`) to 80px (`w-20`) for hero presentation.
 *     Its frame is a neutral hairline, not an orange ring: the username is the
 *     strongest element after the image, and an orange ring competed with it.
 *   - Pencil-edit overlay (PR-B) preserved; only renders on own profile.
 *   - Fallback chain (PR-B) preserved: `profileImageUrl` → first-letter
 *     circle → `getAvatarFallbackUrl()` SVG.
 *
 * The pencil button uses the same focus-visible / contrast tokens as the
 * pre-PR-C version so existing accessibility coverage (audit D5) still holds.
 *
 * The level chip and the XP bar render only when VITE_FEATURE_XP_ENABLED is
 * the literal "true". Off, this card looks the way it does today.
 */
interface Props {
  username: string;
  isVerifiedPro: boolean | undefined;
  stance: string;
  /** Optional custom avatar URL — set by PR-B AvatarPicker upload. */
  profileImageUrl?: string | null;
  /** Owner-only pencil-edit overlay (audit B3). Hidden on opponent profile. */
  isOwnProfile?: boolean;
  /** UID of the profile being viewed — required for AvatarPicker upload target. */
  uid?: string;
  /** Fired after a successful upload so the parent can refresh state. */
  onAvatarUpdated?: (url: string) => void;
  /** Lifetime XP. Absent displays as level 1. Ignored while the XP flag is off. */
  xp?: number;
}

export function ProfileIdentityCard({
  username,
  isVerifiedPro,
  stance,
  profileImageUrl,
  isOwnProfile = false,
  uid,
  onAvatarUpdated,
  xp,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Optimistic mirror of the prop — the parent profile snapshot may not
  // re-fetch until the next mount, so an upload that just succeeded would
  // otherwise still render the initial circle. We override the prop value
  // with the just-uploaded URL until the parent catches up.
  const [optimisticUrl, setOptimisticUrl] = useState<string | null>(null);
  const effectiveUrl = optimisticUrl ?? profileImageUrl ?? null;

  // Fallback chain: profileImageUrl → first-letter circle → SVG fallback.
  // We prefer the initial-circle as the second tier because it's universal
  // and sets up brand recognition; the SVG only fires when the circle
  // can't render (e.g. empty username, which the rules already prevent).
  const initial = username[0]?.toUpperCase() ?? "";
  const showCustom = typeof effectiveUrl === "string" && effectiveUrl.length > 0;
  const showInitial = !showCustom && initial !== "";
  const showFallbackSvg = !showCustom && !showInitial;

  const showXp = isXpEnabled();
  const progress = xpProgress(xp);
  const barClass = BAR_WIDTH[Math.min(20, Math.max(0, Math.round(progress.fraction * 20)))];

  return (
    <div className="mb-4 animate-fade-in">
      <div className="flex items-center gap-4">
        <div className="relative">
          <div className="w-20 h-20 rounded-full bg-surface-alt border border-white/[0.06] flex items-center justify-center shrink-0 shadow-card overflow-hidden">
            {showCustom && (
              // Hero avatar is above-the-fold — `loading="lazy"` (audit
              // C-ISSUE-1) would defer the request unnecessarily and
              // delay paint on the most prominent element. 80px is the w-20 slot.
              <AvatarImage src={effectiveUrl as string} size={80} className="w-full h-full object-cover" />
            )}
            {showInitial && <span className="font-display text-3xl text-white/80 leading-none">{initial}</span>}
            {showFallbackSvg && (
              // Hero fallback also above-the-fold (audit C-ISSUE-1).
              <AvatarImage src={getAvatarFallbackUrl()} size={80} className="w-full h-full object-cover" />
            )}
          </div>
          {isOwnProfile && uid && (
            // 44×44 hit area (Apple HIG / audit B-BLOCKER-2). The visual
            // pencil chip stays at 24×24; transparent padding around it
            // extends the tap target to the minimum without disturbing
            // the existing layout.
            <button
              type="button"
              aria-label="Edit profile picture"
              onClick={() => setPickerOpen(true)}
              className="absolute -bottom-1 -right-1 w-11 h-11 p-2 rounded-full bg-transparent flex items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              <span className="w-7 h-7 rounded-full bg-brand-orange text-[#1a1a1a] flex items-center justify-center shadow-md">
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
              </span>
            </button>
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="font-display text-3xl text-white leading-none tracking-wide">
              <ProUsername username={username} isVerifiedPro={isVerifiedPro} />
            </h1>
            {showXp && <LevelChip level={progress.level} />}
          </div>
          <p className="font-body text-xs text-muted mt-1.5 capitalize">{stance}</p>
        </div>
        {pickerOpen && uid && (
          <AvatarPicker
            uid={uid}
            onUploaded={(url) => {
              setPickerOpen(false);
              setOptimisticUrl(url);
              onAvatarUpdated?.(url);
            }}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
      {showXp && (
        <div className="mt-3" data-testid="xp-progress">
          <div className="h-1.5 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
            <div className={`h-full bg-brand-orange ${barClass}`} />
          </div>
          <p className="font-body text-xs text-muted mt-1">{progress.label}</p>
        </div>
      )}
    </div>
  );
}
