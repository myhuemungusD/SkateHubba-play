import { Palette } from "lucide-react";

const BTN =
  "flex-1 min-h-[44px] px-3 rounded-xl bg-surface border border-white/[0.06] shadow-card font-display text-xs tracking-wider text-white/80 hover:text-white hover:bg-surface-alt transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

interface Props {
  onEditProfile?: () => void;
  onViewMyStats?: () => void;
  onShare: () => void;
  shareCopied: boolean;
  onCustomize?: () => void;
}

/**
 * Own-profile secondary actions: Edit / Share / Customize side by side, then
 * the owner-only My Stats drill-down on its own row (a third label on the
 * first row wraps at 430px). Neutral styling so neither competes with the
 * Challenge CTA.
 */
export function OwnProfileActions({ onEditProfile, onViewMyStats, onShare, shareCopied, onCustomize }: Props) {
  return (
    <>
      <div className={`flex items-center gap-2 ${onViewMyStats ? "mb-2" : "mb-6"}`}>
        {onEditProfile && (
          <button type="button" onClick={onEditProfile} data-testid="edit-profile-button" className={BTN}>
            EDIT PROFILE
          </button>
        )}
        <button
          type="button"
          onClick={onShare}
          data-testid="share-my-profile-button"
          className={BTN}
          aria-label="Share my profile"
        >
          {shareCopied ? "LINK COPIED" : "SHARE"}
        </button>
        {onCustomize && (
          <button
            type="button"
            onClick={onCustomize}
            data-testid="customize-profile-button"
            aria-label="Customize profile"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-surface border border-white/[0.06] shadow-card text-white/80 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <Palette size={16} />
          </button>
        )}
      </div>
      {onViewMyStats && (
        <button
          type="button"
          onClick={onViewMyStats}
          data-testid="my-stats-button"
          className={BTN.replace("flex-1", "w-full mb-6")}
        >
          MY STATS
        </button>
      )}
    </>
  );
}
