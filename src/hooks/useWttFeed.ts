/**
 * Hook for managing What's That Trick (WTT) feed state.
 * Fetches open items, submits votes, tracks daily progress.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchWttItems, fetchWttReliability, submitWttVote } from "../services/wtt";
import type { WttChoice, WttItem, WttReliability } from "../services/wtt.types";
import { logger } from "../services/logger";
import { errorLogFields } from "../utils/errors";

interface UseWttFeedResult {
  items: WttItem[];
  loading: boolean;
  error: Error | null;
  reliability: WttReliability | null;
  currentItem: WttItem | null;
  submitAnswer: (choice: WttChoice) => Promise<void>;
  skipCurrent: () => void;
  loadMore: () => Promise<void>;
  dailyCount: number;
  dailyLimit: number;
}

const DAILY_WTT_LIMIT = 20;
const WTT_BATCH_SIZE = 10;

/**
 * Manages WTT item queue, vote submission, and daily limits.
 */
export function useWttFeed(uid: string, enabled = true): UseWttFeedResult {
  const [items, setItems] = useState<WttItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const [reliability, setReliability] = useState<WttReliability | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dailyCount, setDailyCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;

    const loadData = async () => {
      try {
        setLoading(true);
        const [fetchedItems, stats] = await Promise.all([fetchWttItems(uid, WTT_BATCH_SIZE), fetchWttReliability(uid)]);

        if (!mounted) return;

        setItems(fetchedItems);
        setCurrentIndex(0);
        setReliability(stats);

        if (stats) {
          const today = new Date().toISOString().split("T")[0];
          if (stats.lastAnsweredDay === today) {
            setDailyCount(Math.min(DAILY_WTT_LIMIT, stats.goldSeen));
          }
        }
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err : new Error("Failed to load WTT items"));
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadData();

    return () => {
      mounted = false;
    };
  }, [uid, enabled]);

  const loadMore = useCallback(async () => {
    if (loading || items.length > currentIndex + 3) return;

    try {
      const moreItems = await fetchWttItems(uid, WTT_BATCH_SIZE);
      setItems((prev) => [...prev, ...moreItems]);
    } catch (err) {
      logger.error("wtt_items_load_more_failed", errorLogFields(err));
    }
  }, [uid, loading, items.length, currentIndex]);

  const submitAnswer = useCallback(
    async (choice: WttChoice) => {
      const current = items[currentIndex];
      if (!current) return;

      // A failed vote rejects to the caller, which shows its own error UI.
      await submitWttVote(current.clipId, uid, choice);
      setDailyCount((prev) => prev + 1);
      setCurrentIndex((prev) => prev + 1);
      void loadMore();
    },
    [items, currentIndex, uid, loadMore],
  );

  const skipCurrent = useCallback(() => {
    setCurrentIndex((prev) => prev + 1);
    void loadMore();
  }, [loadMore]);

  return {
    items,
    loading,
    error,
    reliability,
    currentItem: items[currentIndex] ?? null,
    submitAnswer,
    skipCurrent,
    loadMore,
    dailyCount,
    dailyLimit: DAILY_WTT_LIMIT,
  };
}
