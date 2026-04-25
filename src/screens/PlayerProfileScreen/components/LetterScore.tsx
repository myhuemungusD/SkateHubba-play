import { LETTERS } from "../../../utils/helpers";

export function LetterScore({ count, label }: { count: number; label: string }) {
  return (
    <div
      className="flex items-center gap-1"
      aria-label={`${label}: ${LETTERS.slice(0, count).join(".")}${count > 0 ? "." : "none"}`}
    >
      {LETTERS.map((l, i) => (
        <span
          key={i}
          className={`font-display text-[11px] leading-none ${i < count ? "text-brand-red" : "text-[#2E2E2E]"}`}
        >
          {l}
        </span>
      ))}
    </div>
  );
}
