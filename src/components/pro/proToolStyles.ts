// Shared styles and helpers for the pro community tool cards.
export const CARD = "rounded-2xl border border-amber-300/20 bg-surface p-4 shadow-card";
export const H3 = "mb-1 flex items-center gap-2 font-display text-sm tracking-[0.15em] text-white";
export const BTN =
  "min-h-[36px] rounded-lg border border-white/[0.1] px-3 font-body text-xs text-white/90 hover:bg-surface-alt disabled:opacity-50";
export const INPUT =
  "min-h-[36px] w-full rounded-lg border border-white/[0.1] bg-surface-alt px-3 font-body text-sm text-white";

export interface Pro {
  uid: string;
  username: string;
}

export const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);
