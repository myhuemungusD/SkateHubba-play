import { lazy, Suspense } from "react";
import type { WttChoice, WttItem } from "../../services/wtt.types";

const NameItCard = lazy(() => import("../NameItCard").then((m) => ({ default: m.NameItCard })));

interface WttNameItOverlayProps {
  currentItem: WttItem | null;
  dailyCount: number;
  dailyLimit: number;
  loading: boolean;
  onAnswer: (choice: WttChoice) => Promise<void>;
  onSkipCurrent: () => void;
  onBackToScroll: () => void;
}

/**
 * Overlay for WTT Name It mode.
 * Shows the current quiz card or the daily limit reached message.
 */
export function WttNameItOverlay({
  currentItem,
  dailyCount,
  dailyLimit,
  loading,
  onAnswer,
  onSkipCurrent,
  onBackToScroll,
}: WttNameItOverlayProps) {
  if (dailyCount >= dailyLimit) {
    return (
      <div className="absolute inset-0 z-20 flex items-center justify-center px-6">
        <div className="text-center">
          <p className="font-display text-2xl text-white">Daily {dailyLimit} done 🔥</p>
          <p className="font-body text-sm text-faint mt-2">Come back tomorrow to keep your streak!</p>
          <button
            type="button"
            onClick={onBackToScroll}
            className="mt-6 rounded-full border border-brand-orange bg-brand-orange/20 px-6 py-2 font-body text-sm text-white"
          >
            Back to Scroll
          </button>
        </div>
      </div>
    );
  }

  if (!currentItem) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <NameItCard item={currentItem} onAnswer={onAnswer} onSkip={onSkipCurrent} disabled={loading} />
    </Suspense>
  );
}
