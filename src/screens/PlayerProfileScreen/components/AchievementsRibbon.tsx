import { useState } from "react";
import {
  achievementFamilies,
  BRONZE_ACHIEVEMENTS,
  type AchievementDef,
  type AchievementTier,
} from "../../../constants/xp";
import type { Achievement } from "../../../services/achievements";

interface Props {
  achievements?: Achievement[];
  /** Lights the Clips tiles from the counter before the achievement doc exists. */
  clipsPosted?: number;
}

const TIER_LABEL: Record<AchievementTier, string> = {
  bronze: "Bronze",
  silver: "Silver",
  gold: "Gold",
};

export function AchievementsRibbon({ achievements = [], clipsPosted = 0 }: Props) {
  const [seeAll, setSeeAll] = useState(false);
  const earned = new Set(achievements.map((item) => item.id));

  return (
    <section aria-label="Achievements" data-testid="achievements-ribbon" className="mb-8 animate-fade-in">
      <div className="flex items-baseline justify-between mb-3">
        <h2 className="font-display text-[10px] tracking-[0.2em] text-brand-orange">ACHIEVEMENTS</h2>
        <button
          type="button"
          className="font-display text-[10px] tracking-wider text-muted hover:text-white min-h-[44px] px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          onClick={() => setSeeAll(true)}
        >
          See all
        </button>
      </div>
      <ul className="grid grid-cols-4 md:grid-cols-6 gap-2">
        {BRONZE_ACHIEVEMENTS.map((def) => (
          <li key={def.id}>
            <Tile def={def} lit={isLit(def, earned, clipsPosted)} />
          </li>
        ))}
      </ul>
      {seeAll && (
        <div role="dialog" aria-label="All achievements" className="fixed inset-0 z-50 bg-black/80 overflow-y-auto">
          <div className="max-w-lg mx-auto px-4 py-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-sm tracking-wider text-white">ALL ACHIEVEMENTS</h2>
              <button
                type="button"
                className="font-display text-xs tracking-wider text-brand-orange min-h-[44px] px-3"
                onClick={() => setSeeAll(false)}
              >
                Close
              </button>
            </div>
            {achievementFamilies().map((group) => (
              <section key={group.family} className="mb-5" aria-label={group.family}>
                <h3 className="font-display text-[10px] tracking-[0.2em] text-muted mb-2 uppercase">{group.family}</h3>
                <ul className="grid grid-cols-3 gap-2">
                  {group.tiers.map((def) => (
                    <li key={def.id}>
                      <Tile def={def} lit={isLit(def, earned, clipsPosted)} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function isLit(def: AchievementDef, earned: Set<string>, clipsPosted: number): boolean {
  if (earned.has(def.id)) return true;
  return def.counter === "clipsPosted" && clipsPosted >= def.threshold;
}

function Tile({ def, lit }: { def: AchievementDef; lit: boolean }) {
  const label = lit
    ? `${def.shortName}, ${TIER_LABEL[def.tier]}, unlocked. ${def.requirement}`
    : `${def.shortName}, locked. ${def.requirement}`;
  return (
    <div
      role="img"
      data-testid={`achievement-tile-${def.id}`}
      aria-label={label}
      className={
        lit
          ? "aspect-square rounded-2xl bg-brand-orange/[0.12] border border-brand-orange/40 flex flex-col items-center justify-center gap-1 px-1"
          : "aspect-square rounded-2xl bg-surface/60 border border-border flex flex-col items-center justify-center gap-1 px-1 grayscale select-none"
      }
    >
      {!lit && <LockSilhouette />}
      <span
        className={`font-display text-[10px] tracking-wider text-center leading-tight ${lit ? "text-brand-orange" : "text-subtle"}`}
      >
        {def.shortName}
      </span>
      <span className="font-body text-[9px] text-muted">{TIER_LABEL[def.tier]}</span>
    </div>
  );
}

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
