import { LETTERS } from "../utils/helpers";

export function LetterDisplay({ count, name, active }: { count: number; name: string; active?: boolean }) {
  return (
    <div
      className={`flex flex-col items-center gap-2 px-4 py-3.5 rounded-2xl border transition-all duration-300 ease-smooth min-w-[88px] backdrop-blur-sm
        ${active ? "border-brand-orange/40 bg-brand-orange/[0.08] shadow-glow-sm" : "border-white/[0.06] bg-surface/40"}`}
      aria-label={`${name}: ${LETTERS.slice(0, count).join(".")}${count > 0 ? "." : "no letters"}`}
    >
      <span className={`font-body text-xs font-semibold tracking-wide ${active ? "text-brand-orange" : "text-muted"}`}>
        {name}
      </span>
      <div className="flex gap-1.5">
        {LETTERS.map((l, i) => (
          <span
            key={i}
            className={`font-display text-xl transition-all duration-300 ease-smooth
              ${i < count ? "text-brand-red scale-110 drop-shadow-[0_0_12px_rgba(255,61,0,0.5)]" : "text-[#2A2A2A]"}`}
          >
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}
