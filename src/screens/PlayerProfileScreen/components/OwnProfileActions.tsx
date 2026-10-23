import { Palette } from "lucide-react";

/** Shared tokens (src/index.css): btn-secondary / btn-primary-fill + press-feedback. */
const SHAPE =
  "min-h-[44px] rounded-xl font-display text-xs tracking-wider press-feedback focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
const BTN = `flex-1 px-3 btn-secondary ${SHAPE}`;
const PRIMARY = `flex-1 px-3 btn-primary-fill ${SHAPE}`;

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
 * first row wraps at 430px). Edit Profile is the filled primary; the rest are
 * secondary. This row only renders on your own profile, where there is no
 * Challenge CTA to compete with.
 */
export function OwnProfileActions({ onEditProfile, onViewMyStats, onShare, shareCopied, onCustomize }: Props) {
  return (
    <>
      <div className={`flex items-center gap-2 ${onViewMyStats ? "mb-2" : "mb-6"}`}>
        {onEditProfile && (
          <button type="button" onClick={onEditProfile} data-testid="edit-profile-button" className={PRIMARY}>
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
            className={`min-w-[44px] inline-flex items-center justify-center btn-secondary ${SHAPE}`}
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
