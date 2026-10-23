/**
 * What's That Trick (WTT) quiz card.
 * Shows 4 trick options + "Not sure" / "Not landed" secondary buttons.
 * Benchmarked against Duolingo's instant feedback pattern.
 */

import { useCallback, useState } from "react";
import type { WttChoice, WttItem } from "../services/wtt.types";
import { TRICKS } from "../constants/tricks";

interface Props {
  item: WttItem;
  onAnswer: (choice: WttChoice) => Promise<void>;
  onSkip: () => void;
  disabled?: boolean;
}

/**
 * WTT quiz card: looped clip + 4 options + secondary buttons.
 * After answer: shows right/wrong or crowd %.
 */
export function NameItCard({ item, onAnswer, onSkip, disabled = false }: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(false);

  const handleAnswer = useCallback(
    async (choice: WttChoice) => {
      if (submitting || result) return;
      setSubmitting(true);
      try {
        await onAnswer(choice);
        setResult(true);
        setTimeout(() => {
          setResult(false);
          setSubmitting(false);
        }, 2000);
      } catch (error) {
        console.error("Failed to submit WTT vote:", error);
        setSubmitting(false);
      }
    },
    [submitting, result, onAnswer],
  );

  const getTrickName = (trickId: string): string => {
    const trick = TRICKS.find((t) => t.id === trickId);
    return trick?.name ?? trickId;
  };

  return (
    <div className="absolute inset-x-0 bottom-32 z-20 px-4">
      {result ? (
        <div className="bg-black/90 backdrop-blur-md rounded-2xl p-6 text-center">
          <p className="font-body text-faint">
            {item.top && item.topPosterior >= 0.6
              ? `${Math.round(item.topPosterior * 100)}% of skaters said ${getTrickName(item.top)}`
              : "The crowd is split on this one"}
          </p>
        </div>
      ) : (
        <div className="bg-black/90 backdrop-blur-md rounded-2xl p-4">
          <p className="font-display text-sm tracking-wider text-brand-orange text-center mb-3">WHAT'S THAT TRICK?</p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {item.options.map((trickId) => (
              <button
                key={trickId}
                type="button"
                disabled={disabled || submitting}
                onClick={() => handleAnswer(trickId)}
                className="
                  min-h-11 px-4 py-3 rounded-xl
                  bg-white/10 hover:bg-white/20
                  border border-white/20 hover:border-white/40
                  font-body text-sm text-white
                  transition-all active:scale-95
                  disabled:opacity-50
                "
              >
                {getTrickName(trickId)}
                {item.aliases?.[trickId] && <span className="block text-xs text-faint">{item.aliases[trickId]}</span>}
              </button>
            ))}
          </div>
          <div className="flex gap-2 justify-center">
            <button
              type="button"
              disabled={disabled || submitting}
              onClick={() => handleAnswer("unsure")}
              className="
                px-3 py-1.5 rounded-full
                border border-faint text-faint
                font-body text-xs
                hover:border-white/40 hover:text-white/80
                transition-colors
                disabled:opacity-50
              "
            >
              Not sure
            </button>
            <button
              type="button"
              disabled={disabled || submitting}
              onClick={() => handleAnswer("not_landed")}
              className="
                px-3 py-1.5 rounded-full
                border border-faint text-faint
                font-body text-xs
                hover:border-white/40 hover:text-white/80
                transition-colors
                disabled:opacity-50
              "
            >
              Not landed
            </button>
            <button
              type="button"
              disabled={disabled || submitting}
              onClick={onSkip}
              className="
                px-3 py-1.5 rounded-full
                border border-faint text-faint
                font-body text-xs
                hover:border-white/40 hover:text-white/80
                transition-colors
                disabled:opacity-50
              "
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
