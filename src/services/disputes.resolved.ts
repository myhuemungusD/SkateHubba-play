/** Participant-facing lookup for the resolved dispute attached to one turn. */
import { doc, getDoc } from "firebase/firestore";
import { requireDb } from "../firebase";
import { disputeId, toDisputeDoc, type Dispute } from "./disputes.mappers";

/**
 * Reads exactly one deterministic document rather than querying closed
 * disputes. Firestore rules independently verify that the caller participates
 * in the document's game; this function is only the client read shape.
 */
export async function fetchResolvedDispute(gameId: string, turnNumber: number): Promise<Dispute | null> {
  const snap = await getDoc(doc(requireDb(), "disputes", disputeId(gameId, turnNumber)));
  if (!snap.exists()) return null;

  const dispute = toDisputeDoc(snap);
  return dispute.status === "closed" ? dispute : null;
}
