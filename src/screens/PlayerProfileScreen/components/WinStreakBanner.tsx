import { FlameIcon } from "../../../components/icons";

interface Props {
  currentStreak: number;
}

export function WinStreakBanner({ currentStreak }: Props) {
  return (
    <div
      className="flex items-center justify-center gap-2.5 mb-8 px-4 py-3.5 rounded-xl border border-brand-orange/30 bg-brand-orange/[0.06] shadow-glow-sm animate-scale-in"
      role="status"
      aria-label={`${currentStreak} game win streak`}
    >
      <FlameIcon size={18} className="text-brand-orange" />
      <span className="font-display text-sm tracking-wider text-brand-orange">{currentStreak} WIN STREAK</span>
      <FlameIcon size={18} className="text-brand-orange" />
    </div>
  );
}
