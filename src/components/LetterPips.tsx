import { LETTERS } from "../utils/helpers";

/**
 * Spoken form of a letter count, e.g. "S K, 2 of 5". Screen readers and
 * Voice Control get the score in words, not just as coloured glyphs.
 */
export function lettersLabel(count: number): string {
  const earned = LETTERS.slice(0, count).join(" ");
  return `${earned || "no letters"}, ${count} of ${LETTERS.length}`;
}

// Row widths (5 pips + 4 gaps): sm 116px, md 136px, lg 176px.
// "fit" picks the largest that fits its nearest @container (see LetterDisplay):
// sm below 8.5rem, md from 8.5rem, lg from 11rem.
const SIZE = {
  sm: "h-5 min-w-5 px-0.5 text-sm",
  md: "h-6 min-w-6 px-0.5 text-base",
  lg: "h-8 min-w-8 px-1 text-xl",
  fit: "h-5 min-w-5 px-0.5 text-sm @[8.5rem]:h-6 @[8.5rem]:min-w-6 @[8.5rem]:text-base @[11rem]:h-8 @[11rem]:min-w-8 @[11rem]:px-1 @[11rem]:text-xl",
} as const;

/**
 * The S·K·A·T·E row. Earned letters are solid red chips and unearned ones
 * are faint outlines, so the score reads by shape as well as colour
 * (WCAG 1.4.1). This is the one letter row; every score display uses it.
 */
export function LetterPips({ count, label, size = "sm" }: { count: number; label: string; size?: keyof typeof SIZE }) {
  return (
    <span
      role="img"
      aria-label={`${label}: ${lettersLabel(count)}`}
      className="inline-flex shrink-0 items-center gap-1"
    >
      {LETTERS.map((l, i) => {
        const earned = i < count;
        return (
          <span
            key={l}
            aria-hidden="true"
            data-earned={earned ? "true" : "false"}
            className={`inline-flex items-center justify-center rounded font-display leading-none ${SIZE[size]} ${
              earned ? "bg-brand-red text-black" : "border border-white/45 text-white/45"
            }`}
          >
            {l}
          </span>
        );
      })}
    </span>
  );
}
