import { collection, doc, runTransaction, query, where, limit, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { requireDb } from "../firebase";
import { captureException } from "../lib/sentry";

/* ────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────── */

export interface DisputeDoc {
  id: string;
  gameId: string;
  turnNumber: number;
  trickName: string;
  setterUid: string;
  matcherUid: string;
  setterUsername: string;
  matcherUsername: string;
  setVideoUrl: string | null;
  matchVideoUrl: string | null;
  setterVote: boolean;
  matcherVote: boolean;
  status: "open" | "resolved";
  resolution: boolean | null;
  /** Map of juror UID → their vote (true = landed) */
  juryVotes: Record<string, boolean>;
  jurySize: number;
  createdAt: unknown;
}

const JURY_THRESHOLD = 3;

function disputesRef() {
  return collection(requireDb(), "disputes");
}

function toDisputeDoc(snap: { id: string; data: () => Record<string, unknown> }): DisputeDoc {
  const raw = snap.data();
  if (typeof raw.gameId !== "string" || typeof raw.setterUid !== "string") {
    throw new Error(`Malformed dispute document: ${snap.id}`);
  }
  return { id: snap.id, ...raw } as DisputeDoc;
}

/* ────────────────────────────────────────────
 * Submit a jury vote on a dispute
 * ──────────────────────────────────────────── */

export async function submitJuryVote(
  disputeId: string,
  voterUid: string,
  landed: boolean,
): Promise<{ resolved: boolean; resolution: boolean | null }> {
  const disputeRef = doc(requireDb(), "disputes", disputeId);

  return runTransaction(requireDb(), async (tx) => {
    const snap = await tx.get(disputeRef);
    if (!snap.exists()) throw new Error("Dispute not found");

    const dispute = toDisputeDoc(snap);
    if (dispute.status !== "open") throw new Error("Dispute is already resolved");

    // Juror must not be a player in the dispute
    if (voterUid === dispute.setterUid || voterUid === dispute.matcherUid) {
      throw new Error("Players cannot vote on their own dispute");
    }

    // Check for double-voting
    if (voterUid in dispute.juryVotes) {
      throw new Error("You already voted on this dispute");
    }

    const newJuryVotes = { ...dispute.juryVotes, [voterUid]: landed };
    const newJurySize = dispute.jurySize + 1;

    const updates: Record<string, unknown> = {
      juryVotes: newJuryVotes,
      jurySize: newJurySize,
    };

    let resolved = false;
    let resolution: boolean | null = null;

    if (newJurySize >= JURY_THRESHOLD) {
      // Tally votes
      const votes = Object.values(newJuryVotes);
      const landedCount = votes.filter((v) => v === true).length;
      const missedCount = votes.filter((v) => v === false).length;
      resolution = landedCount > missedCount;
      resolved = true;
      updates.status = "resolved";
      updates.resolution = resolution;
    }

    tx.update(disputeRef, updates);
    return { resolved, resolution };
  });
}

/* ────────────────────────────────────────────
 * Subscribe to open disputes (for jury duty queue)
 * Excludes disputes where the current user is a player
 * ──────────────────────────────────────────── */

export function subscribeToOpenDisputes(currentUid: string, onUpdate: (disputes: DisputeDoc[]) => void): Unsubscribe {
  const q = query(disputesRef(), where("status", "==", "open"), limit(20));

  return onSnapshot(
    q,
    (snap) => {
      const disputes = snap.docs
        .map((d) => toDisputeDoc(d))
        .filter((d) => d.setterUid !== currentUid && d.matcherUid !== currentUid)
        .filter((d) => !(currentUid in d.juryVotes));
      onUpdate(disputes);
    },
    (err) => {
      console.warn("Dispute subscription error:", err.message);
      captureException(err, { extra: { context: "subscribeToOpenDisputes", currentUid } });
      onUpdate([]);
    },
  );
}

/* ────────────────────────────────────────────
 * Subscribe to a single dispute for real-time updates
 * ──────────────────────────────────────────── */

export function subscribeToDispute(disputeId: string, onUpdate: (dispute: DisputeDoc | null) => void): Unsubscribe {
  return onSnapshot(
    doc(requireDb(), "disputes", disputeId),
    (snap) => {
      if (!snap.exists()) {
        onUpdate(null);
        return;
      }
      onUpdate(toDisputeDoc(snap));
    },
    (err) => {
      console.warn("Dispute subscription error for:", disputeId, err.message);
      captureException(err, { extra: { context: "subscribeToDispute", disputeId } });
      onUpdate(null);
    },
  );
}
