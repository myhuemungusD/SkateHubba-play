import { doc, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { requireDb } from "../firebase";
import type { Dispute } from "../types/dispute";
import { disputeId, toDisputeDoc } from "./disputes.mappers";

/**
 * Keep one game's deterministic dispute document current.
 *
 * A missing snapshot is reported as `null`, while permission/network errors
 * use the error callback. Mapper failures also take the error path instead of
 * escaping from Firestore's snapshot callback as an uncaught exception.
 */
export function subscribeToGameDispute(
  gameId: string,
  turnNumber: number,
  onChange: (dispute: Dispute | null) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const ref = doc(requireDb(), "disputes", disputeId(gameId, turnNumber));
  return onSnapshot(
    ref,
    (snap) => {
      try {
        onChange(snap.exists() ? toDisputeDoc(snap) : null);
      } catch (error) {
        onError(error instanceof Error ? error : new Error("Failed to read dispute document"));
      }
    },
    onError,
  );
}
