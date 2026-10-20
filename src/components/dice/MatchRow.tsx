import { ChevronRight } from "lucide-react";

export interface MatchRowProps {
  name: string;
  /** "C-Lo · Race to 5" */
  meta: string;
  /** "3 – 1", or null before the match starts. */
  score: string | null;
  /** "Your roll · 21h left", "Won · +16 Rep" */
  status: string;
  tone: "act" | "wait" | "won" | "lost" | "void";
  onOpen: () => void;
}

const TONE: Record<MatchRowProps["tone"], string> = {
  act: "text-brand-orange",
  wait: "text-bright",
  won: "text-brand-green",
  lost: "text-bright",
  void: "text-muted",
};

/** One match in the hub list. The whole row opens the table. */
export function MatchRow({ name, meta, score, status, tone, onOpen }: MatchRowProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="dice-match-row"
      className={`flex min-h-16 w-full items-center gap-3 rounded-2xl border bg-surface px-4 py-3 text-left transition-colors hover:border-white/20 ${tone === "act" ? "border-brand-orange/40" : "border-white/[0.06]"}`}
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-white/20 font-display text-lg text-white"
      >
        {name.slice(0, 1).toUpperCase() || "?"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-body text-sm font-semibold text-white">@{name}</span>
        <span className="block truncate font-body text-xs text-muted">{meta}</span>
        <span className={`block truncate font-body text-xs ${TONE[tone]}`}>{status}</span>
      </span>
      {score ? <span className="font-display text-xl tabular-nums text-white">{score}</span> : null}
      <ChevronRight size={18} aria-hidden="true" className="shrink-0 text-muted" />
    </button>
  );
}
