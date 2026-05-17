/**
 * Achievements ribbon — PR-C placeholder (audit D2).
 *
 * Renders 12 grayscale silhouette tiles in a 4-col grid (mobile) / 6-col grid
 * (tablet+). Each tile has "???" + a lock icon overlay. PR-F replaces the
 * static placeholder with a real subscription to `users/{uid}/achievements`
 * and swaps locked → tier-colored unlocked rendering on grant.
 *
 * Why the placeholder ships now (instead of waiting for PR-F):
 *   - Profile redesign needs the visual slot for layout fidelity.
 *   - Even in placeholder state, the slot must convey "locked" via grayscale
 *     **plus** a lock icon **plus** a text label — color cannot be the sole
 *     means of conveyance per WCAG 2.1 AA §1.4.1 (audit D2 fix).
 *
 * Tap-target sizing math (audit D6):
 *   343px iPhone SE viewport / 4 cols ≈ 85px - 8px gap = 77px tappable.
 *   77px > 44pt minimum (62.6px @ 1x). ✓
 */

const PLACEHOLDER_TILE_COUNT = 12;
/** Stable indices so React keys don't churn between renders. */
const placeholderIndices = Array.from({ length: PLACEHOLDER_TILE_COUNT }, (_, i) => i);

interface Props {
  /** Reserved for PR-F — pass `false` to keep placeholders even when the flag
   *  is on (e.g. for testing). PR-C only renders placeholders. */
  forcePlaceholder?: boolean;
}

export function AchievementsRibbon(_props: Props = {}) {
  // In PR-C the only state is "all placeholder" — the prop slot is reserved
  // so PR-F can flip a single boolean without a component split.
  void _props;
  return (
    <section aria-label="Achievements" data-testid="achievements-ribbon" className="mb-8 animate-fade-in">
      <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange mb-3">ACHIEVEMENTS</h2>
      <ul className="grid grid-cols-4 md:grid-cols-6 gap-2">
        {placeholderIndices.map((i) => (
          <li key={i}>
            <PlaceholderTile index={i} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * A single locked-state tile. Built so PR-F can drop in real tier color +
 * tier icon + tier text label without a component rewrite — the slots are
 * already wired for color (`bg-tier-color`), icon (`children`), and label
 * (`<span>`). Until then everything renders neutral grayscale.
 */
function PlaceholderTile({ index }: { index: number }) {
  return (
    <div
      data-testid={`achievement-tile-${index}`}
      aria-label="Locked achievement"
      className="aspect-square rounded-2xl bg-surface/60 border border-border flex flex-col items-center justify-center gap-1 grayscale select-none"
    >
      {/* Tier color slot (PR-F replaces with tier-color background). */}
      <LockSilhouette />
      {/* Tier text label slot (PR-F replaces with localized name). */}
      <span className="font-display text-[10px] tracking-wider text-subtle">???</span>
    </div>
  );
}

/**
 * Lock-icon silhouette rendered inline so we don't pay an extra import for
 * a component used only here. The padlock outline is the audit-D2 mandated
 * "locked" affordance — color-blind users see the lock even without the
 * grayscale wash.
 */
function LockSilhouette() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-faint"
      aria-hidden="true"
      data-testid="lock-icon"
    >
      <rect x="4" y="11" width="16" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
