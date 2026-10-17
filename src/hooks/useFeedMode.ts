/**
 * Hook for managing feed mode state with localStorage persistence.
 * Remembers the last selected mode across sessions.
 */

import { useCallback, useState } from "react";
import type { FeedMode } from "../types/feedMode";

const FEED_MODE_STORAGE_KEY = "skatehubba_feed_mode";
const DEFAULT_MODE: FeedMode = "scroll";

interface UseFeedModeResult {
  mode: FeedMode;
  setMode: (mode: FeedMode) => void;
}

/**
 * Manages feed mode with localStorage persistence.
 * Defaults to "scroll" for first-time users.
 */
export function useFeedMode(): UseFeedModeResult {
  const [mode, setModeState] = useState<FeedMode>(() => {
    try {
      const stored = localStorage.getItem(FEED_MODE_STORAGE_KEY);
      if (stored === "scroll" || stored === "name-it" || stored === "vote" || stored === "judge") {
        return stored;
      }
    } catch {
      // localStorage might be disabled
    }
    return DEFAULT_MODE;
  });

  const setMode = useCallback((newMode: FeedMode) => {
    setModeState(newMode);
    try {
      localStorage.setItem(FEED_MODE_STORAGE_KEY, newMode);
    } catch {
      // localStorage might be disabled
    }
  }, []);

  return { mode, setMode };
}
