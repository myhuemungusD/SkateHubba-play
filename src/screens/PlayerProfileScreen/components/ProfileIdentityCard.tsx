import { useState } from "react";
import { ProUsername } from "../../../components/ProUsername";
import { AvatarPicker } from "../../../components/AvatarPicker";
import { LevelChip } from "../../../components/LevelChip";
import { getAvatarFallbackUrl } from "../../../services/avatars";

/**
 * Identity card at the top of the profile (PR-C — full rewrite per plan §6.4).
 *
 * Visible changes from the pre-PR-C version:
 *   - Avatar grew from 56px (`w-14`) to 96px (`w-24`) for hero presentation.
 *   - Level chip displayed inline next to the username — placeholder L1 until
 *     PR-E activates `feature.profile_xp` and writes real `level`.
 *   - Pencil-edit overlay (PR-B) preserved; only renders on own profile.
 *   - Fallback chain (PR-B) preserved: `profileImageUrl` → first-letter
 *     circle → `getAvatarFallbackUrl()` SVG.
 *
 * The pencil button uses the same focus-visible / contrast tokens as the
 * pre-PR-C version so existing accessibility coverage (audit D5) still holds.
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
  /** Profile level (1..30); defaults to 1 when undefined. PR-E populates. */
  level?: number;
  /** Fired after a successful upload so the parent can refresh state. */
  onAvatarUpdated?: (url: string) => void;
}

export function ProfileIdentityCard({
  username,
  isVerifiedPro,
  stance,
  profileImageUrl,
  isOwnProfile = false,
  uid,
  level,
  onAvatarUpdated,
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

  return (
    <div className="flex items-center gap-4 mb-6 animate-fade-in">
      <div className="relative">
        <div className="w-24 h-24 rounded-full bg-brand-orange/[0.12] border-2 border-brand-orange/30 flex items-center justify-center shrink-0 shadow-glow-sm overflow-hidden">
          {showCustom && (
            // Hero avatar is above-the-fold — `loading="lazy"` (audit
            // C-ISSUE-1) would defer the request unnecessarily and
            // delay paint on the most prominent element.
            <img src={effectiveUrl as string} alt="" decoding="async" className="w-full h-full object-cover" />
          )}
          {showInitial && <span className="font-display text-4xl text-brand-orange leading-none">{initial}</span>}
          {showFallbackSvg && (
            // Hero fallback also above-the-fold (audit C-ISSUE-1).
            <img src={getAvatarFallbackUrl()} alt="" decoding="async" className="w-full h-full object-cover" />
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
            <span className="w-7 h-7 rounded-full bg-brand-orange text-white flex items-center justify-center shadow-md">
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
          <LevelChip level={level ?? 1} />
        </div>
        <p className="font-body text-xs text-muted mt-2 capitalize">{stance}</p>
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
  );
}
