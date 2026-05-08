import { useState } from "react";
import { ProUsername } from "../../../components/ProUsername";
import { AvatarPicker } from "../../../components/AvatarPicker";
import { getAvatarFallbackUrl } from "../../../services/avatars";

interface Props {
  username: string;
  isVerifiedPro: boolean | undefined;
  stance: string;
  /** Optional custom avatar URL — set by PR-B AvatarPicker upload. */
  profileImageUrl?: string | null;
  /** When viewing the signed-in user's own profile, render a pencil-edit
   *  overlay that opens the AvatarPicker (audit B3). Hidden on opponent
   *  profiles so users can't accidentally re-upload from there. */
  isOwnProfile?: boolean;
  /** UID of the profile being viewed — handed to AvatarPicker as the
   *  upload target. Required when `isOwnProfile === true`. */
  uid?: string;
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
  onAvatarUpdated,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Optimistic mirror of the prop — the parent profile snapshot may not
  // re-fetch until the next mount, so an upload that just succeeded
  // would otherwise still render the initial circle. We override the
  // prop value with the just-uploaded URL until the parent catches up.
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
    <div className="flex items-center gap-4 mb-8 animate-fade-in">
      <div className="relative">
        <div className="w-14 h-14 rounded-full bg-brand-orange/[0.12] border-2 border-brand-orange/30 flex items-center justify-center shrink-0 shadow-glow-sm overflow-hidden">
          {showCustom && (
            <img
              src={effectiveUrl as string}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          )}
          {showInitial && (
            <span className="font-display text-xl text-brand-orange leading-none">{initial}</span>
          )}
          {showFallbackSvg && (
            <img
              src={getAvatarFallbackUrl()}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover"
            />
          )}
        </div>
        {isOwnProfile && uid && (
          <button
            type="button"
            aria-label="Edit profile picture"
            onClick={() => setPickerOpen(true)}
            className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-brand-orange text-white flex items-center justify-center shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        )}
      </div>
      <div>
        <h1 className="font-display text-3xl text-white leading-none tracking-wide">
          <ProUsername username={username} isVerifiedPro={isVerifiedPro} />
        </h1>
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
  );
}
