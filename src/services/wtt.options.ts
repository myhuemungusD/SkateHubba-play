/**
 * WTT option generation: build 4-option quizzes using confusion map.
 * Benchmarked against MTurk's gold-question pattern.
 */

import { getConfusableTricks, getRandomDistractor, trickById } from "../constants/tricks";

export interface WttQuizOptions {
  options: [string, string, string, string];
  correctIndex: number;
}

/**
 * Generate 4 quiz options for a trick.
 * - Option 1: Correct answer (filer label or posterior top-1)
 * - Options 2-3: Confusable neighbors from confusion map
 * - Option 4: Random plausible distractor from same category
 * Then shuffle so the correct answer position is unpredictable.
 */
export function generateWttOptions(correctTrickId: string): WttQuizOptions | null {
  const correctTrick = trickById(correctTrickId);
  if (!correctTrick) return null;

  const options: string[] = [correctTrickId];
  const usedIds = new Set([correctTrickId]);

  // Add confusable neighbors (up to 2)
  const confusables = getConfusableTricks(correctTrickId, 2);
  for (const confusableId of confusables) {
    if (options.length >= 4) break;
    if (!usedIds.has(confusableId)) {
      options.push(confusableId);
      usedIds.add(confusableId);
    }
  }

  // Fill remaining slots with random distractors from same category
  while (options.length < 4) {
    const distractor = getRandomDistractor(correctTrickId, usedIds);
    if (!distractor) {
      // Fallback: pick any trick from a different category
      const fallback = getFallbackDistractor(usedIds);
      if (!fallback) break;
      options.push(fallback);
      usedIds.add(fallback);
    } else {
      options.push(distractor);
      usedIds.add(distractor);
    }
  }

  // Need exactly 4 options
  if (options.length < 4) return null;

  // Shuffle options
  const shuffled = shuffleOptions(options);
  const newCorrectIndex = shuffled.indexOf(correctTrickId);

  return {
    options: shuffled as [string, string, string, string],
    correctIndex: newCorrectIndex,
  };
}

function getFallbackDistractor(usedIds: Set<string>): string | null {
  // Import TRICKS from constants - but we can't import here without circular dep
  // So this is a simplified fallback that just returns a common trick
  const commonFallbacks = ["ollie", "kickflip", "heelflip", "pop-shove-it", "bs-180", "fs-180", "50-50", "boardslide"];

  for (const id of commonFallbacks) {
    if (!usedIds.has(id)) return id;
  }

  return null;
}

function shuffleOptions(options: string[]): string[] {
  const shuffled = [...options];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Validate that generated options are distinct and non-empty.
 */
export function validateWttOptions(options: readonly string[]): boolean {
  if (options.length !== 4) return false;
  const uniqueIds = new Set(options);
  if (uniqueIds.size !== 4) return false;
  return options.every((id) => id && id.length > 0);
}
