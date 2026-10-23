import { LETTERS } from "../utils/helpers";

/**
 * Spoken form of a letter count, e.g. "S K, 2 of 5". Screen readers and
 * Voice Control get the score in words, not just as coloured glyphs.
 */
export function lettersLabel(count: number): string {
  const earned = LETTERS.slice(0, count).join(" ");
  return `${earned || "no letters"}, ${count} of ${LETTERS.length}`;
}

const SIZE = {
  sm: "h-5 min-w-5 px-0.5 text-sm",
  lg: "h-8 min-w-8 px-1 text-xl",
} as const;

/**
 * The S·K·A·T·E row. Earned letters are solid red chips and unearned ones
 * are faint outlines, so the score reads by shape as well as colour
 * (WCAG 1.4.1). This is the one letter row; every score display uses it.
 */
export function LetterPips({ count, label, size = "sm" }: { count: number; label: string; size?: keyof typeof SIZE }) {
  return (
    <span role="img" aria-label={`${label}: ${lettersLabel(count)}`} className="inline-flex items-center gap-1">
      {LETTERS.map((l, i) => {
        const earned = i < count;
        return (
          <span
            key={l}
            aria-hidden="true"
            data-earned={earned ? "true" : "false"}
            className={`inline-flex items-center justify-center rounded font-display leading-none ${SIZE[size]} ${
              earned ? "bg-brand-red text-black" : "border border-white/30 text-white/30"
            }`}
          >
            {l}
          </span>
        );
      })}
    </span>
  );
}
