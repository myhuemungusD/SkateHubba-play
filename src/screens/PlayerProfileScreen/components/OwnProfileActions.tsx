import { Palette } from "lucide-react";

/** Shared tokens (src/index.css): btn-secondary / btn-primary-fill + press-feedback. */
const SHAPE =
  "min-h-[44px] rounded-xl font-display text-sm tracking-wider press-feedback focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
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
 * Own-profile actions in one row (audit #9): Edit, Share, Stats, then the
 * Customize palette. Edit is the filled primary; the rest are secondary.
 * Labels stay one word so four controls fit at 375px; each accessible name
 * contains its visible word (WCAG 2.5.3). This row only renders on your
 * own profile, where there is no Challenge CTA to compete with.
 */
export function OwnProfileActions({ onEditProfile, onViewMyStats, onShare, shareCopied, onCustomize }: Props) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {onEditProfile && (
        <button
          type="button"
          onClick={onEditProfile}
          data-testid="edit-profile-button"
          aria-label="Edit profile"
          className={PRIMARY}
        >
          EDIT
        </button>
      )}
      <button
        type="button"
        onClick={onShare}
        data-testid="share-my-profile-button"
        className={BTN}
        aria-label={shareCopied ? "Link copied" : "Share my profile"}
      >
        {shareCopied ? "COPIED" : "SHARE"}
      </button>
      {onViewMyStats && (
        <button
          type="button"
          onClick={onViewMyStats}
          data-testid="my-stats-button"
          aria-label="My stats"
          className={BTN}
        >
          STATS
        </button>
      )}
      {onCustomize && (
        <button
          type="button"
          onClick={onCustomize}
          data-testid="customize-profile-button"
          aria-label="Customize profile"
          className={`min-w-[44px] inline-flex items-center justify-center btn-secondary ${SHAPE}`}
        >
          <Palette size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
