import type { Achievement } from "../services/achievements";
import { getBadgeMeta } from "../constants/badges";

/**
 * Horizontal row of a player's earned badges, rendered between the profile
 * identity card and the stats grid.
 *
 * Renders `null` when the player has earned nothing — an empty "BADGES"
 * heading on a fresh profile reads as a broken section, not an invitation.
 *
 * Ids this build doesn't recognise are skipped (see `constants/badges`), so a
 * server-side grant that ships ahead of the client degrades to "not shown"
 * rather than a chip labelled with a raw key.
 *
 * Accessibility: each chip is a non-interactive `role="img"` whose label
 * carries name + earn condition + earned month, mirroring the stats grid's
 * static-label approach. Chips are 44px so they clear the iOS touch-target
 * floor even though nothing is tappable yet.
 */

interface Props {
  achievements: Achievement[];
}

/** "Jan 2026" — month + year is the right resolution for a lifetime award. */
function formatEarnedAt(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

export function BadgesRow({ achievements }: Props) {
  const earned = achievements.flatMap((achievement) => {
    const meta = getBadgeMeta(achievement.id);
    return meta ? [{ achievement, meta }] : [];
  });

  if (earned.length === 0) return null;

  return (
    <section aria-label="Badges" data-testid="badges-row" className="mb-6 animate-fade-in">
      <ul className="flex items-start gap-4 overflow-x-auto pb-1">
        {earned.map(({ achievement, meta }) => {
          const { Icon, label, description } = meta;
          const earnedAt = achievement.earnedAt ? formatEarnedAt(achievement.earnedAt) : null;
          const ariaLabel = earnedAt ? `${label} — ${description}. Earned ${earnedAt}` : `${label} — ${description}`;

          return (
            <li key={achievement.id} className="shrink-0">
              <div
                role="img"
                aria-label={ariaLabel}
                title={achievement.reason ?? description}
                data-testid={`badge-${achievement.id}`}
                className="flex w-16 flex-col items-center gap-1.5 select-none"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full border border-brand-orange/40 bg-brand-orange/[0.12] text-brand-orange transition-colors hover:border-brand-orange/70 active:scale-95">
                  <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                </span>
                <span className="font-display text-[10px] tracking-wider text-bright text-center leading-tight">
                  {label.toUpperCase()}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
