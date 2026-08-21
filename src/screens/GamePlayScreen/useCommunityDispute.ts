import { useEffect, useState } from "react";
import { subscribeToGameDispute, type Dispute } from "../../services/disputes";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";

export type CommunityDisputeState = "loading" | "ready" | "missing" | "denied" | "unavailable" | "closed";

interface CommunityDisputeResult {
  dispute: Dispute | null;
  state: CommunityDisputeState;
}

interface SubscriptionResult extends CommunityDisputeResult {
  key: string;
}

/** Owns the lifecycle of the deterministic dispute listener for gameplay. */
export function useCommunityDispute(enabled: boolean, gameId: string, turnNumber: number): CommunityDisputeResult {
  const subscriptionKey = `${gameId}:${turnNumber}`;
  const [result, setResult] = useState<SubscriptionResult>({ key: "", dispute: null, state: "loading" });

  useEffect(() => {
    if (!enabled) return;

    let active = true;
    const unsubscribe = subscribeToGameDispute(
      gameId,
      turnNumber,
      (nextDispute) => {
        if (!active) return;
        setResult({
          key: subscriptionKey,
          dispute: nextDispute,
          state: nextDispute === null ? "missing" : nextDispute.status === "closed" ? "closed" : "ready",
        });
      },
      (error) => {
        if (!active) return;
        const code = (error as Error & { code?: string }).code;
        setResult((previous) => ({
          key: subscriptionKey,
          dispute: previous.key === subscriptionKey ? previous.dispute : null,
          state: code === "permission-denied" ? "denied" : "unavailable",
        }));
        logger.warn("community_dispute_subscription_failed", {
          error: parseFirebaseError(error),
          gameId,
        });
      },
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, [enabled, gameId, subscriptionKey, turnNumber]);

  return enabled && result.key === subscriptionKey ? result : { dispute: null, state: "loading" };
}
