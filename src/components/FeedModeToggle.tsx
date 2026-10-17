/**
 * Feed mode switcher for the clips feed.
 * Four text labels: Scroll · Name It · Vote · Judge.
 * Benchmarked against TikTok's For You / Following toggle.
 */

import { useCallback, useMemo } from "react";
import type { FeedMode } from "../types/feedMode";
import { FEED_MODE_LABELS } from "../types/feedMode";

interface Props {
  mode: FeedMode;
  onChange: (mode: FeedMode) => void;
  disabled?: boolean;
  showJudge: boolean;
  showNameIt: boolean;
  disputesPending?: boolean;
  streakDue?: boolean;
}

/**
 * Mode switcher: 2-4 text labels depending on feature flags and eligibility.
 * Active mode is underlined. Tap to switch, or swipe horizontally on the bar.
 */
export function FeedModeToggle({
  mode,
  onChange,
  disabled = false,
  showJudge,
  showNameIt,
  disputesPending = false,
  streakDue = false,
}: Props) {
  const modes = useMemo<FeedMode[]>(() => {
    const result: FeedMode[] = ["scroll"];
    if (showNameIt) result.push("name-it");
    result.push("vote");
    if (showJudge) result.push("judge");
    return result;
  }, [showNameIt, showJudge]);

  const handleSwipe = useCallback(
    (e: React.TouchEvent) => {
      const startX = e.touches[0].clientX;
      const onTouchEnd = (endEvent: Event) => {
        const touchEvent = endEvent as TouchEvent;
        const endX = touchEvent.changedTouches[0].clientX;
        const diff = startX - endX;
        if (Math.abs(diff) > 50) {
          const currentIndex = modes.indexOf(mode);
          if (diff > 0 && currentIndex < modes.length - 1) {
            onChange(modes[currentIndex + 1]);
          } else if (diff < 0 && currentIndex > 0) {
            onChange(modes[currentIndex - 1]);
          }
        }
        e.currentTarget.removeEventListener("touchend", onTouchEnd);
      };
      e.currentTarget.addEventListener("touchend", onTouchEnd);
    },
    [mode, modes, onChange],
  );

  return (
    <div
      className="flex items-center justify-center gap-6 px-4 py-3 bg-black/80 backdrop-blur-sm"
      onTouchStart={handleSwipe}
    >
      {modes.map((m) => {
        const isActive = m === mode;
        const badge = (m === "judge" && disputesPending) || (m === "name-it" && streakDue);

        return (
          <button
            key={m}
            type="button"
            disabled={disabled}
            onClick={() => onChange(m)}
            className={`
              relative font-body text-sm transition-all
              ${isActive ? "font-semibold text-white" : "text-faint"}
              ${disabled ? "opacity-50" : ""}
            `}
            aria-pressed={isActive}
          >
            {FEED_MODE_LABELS[m]}
            {isActive && <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-brand-orange rounded-full" />}
            {badge && !isActive && <span className="absolute -top-1 -right-1 w-2 h-2 bg-brand-orange rounded-full" />}
          </button>
        );
      })}
    </div>
  );
}
