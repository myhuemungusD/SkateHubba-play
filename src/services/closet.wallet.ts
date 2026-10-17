/**
 * Closet wallet service — fetch Hubba Bucks balance and transaction history.
 * Private to the owner; server-only writes.
 */
import { doc, getDoc, collection, getDocs, query, orderBy, limit as fbLimit } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";
import { toDateOrNull } from "./closet.time";

export interface WalletBalance {
  balance: number;
  earnedBal: number;
  boughtBal: number;
}

export interface LedgerEntry {
  id: string;
  amount: number;
  reason: string;
  createdAt: Date;
  source: "earned" | "bought" | "spent";
  ref: string | null;
}

/**
 * Fetch the user's current Hubba Bucks balance.
 * Returns zero balance if wallet doesn't exist yet.
 */
export async function fetchWalletBalance(uid: string): Promise<WalletBalance> {
  try {
    const snap = await withRetry(() => getDoc(doc(requireDb(), "users", uid, "wallet", "main")));
    const data = snap.data();

    if (!data) {
      return { balance: 0, earnedBal: 0, boughtBal: 0 };
    }

    return {
      balance: typeof data.balance === "number" ? data.balance : 0,
      earnedBal: typeof data.earnedBal === "number" ? data.earnedBal : 0,
      boughtBal: typeof data.boughtBal === "number" ? data.boughtBal : 0,
    };
  } catch (err) {
    logger.warn("fetch_wallet_failed", { uid, error: parseFirebaseError(err) });
    return { balance: 0, earnedBal: 0, boughtBal: 0 };
  }
}

/**
 * Fetch recent ledger entries for the user.
 * Returns newest first, limited to the specified count.
 */
export async function fetchLedgerHistory(uid: string, limitCount = 50): Promise<LedgerEntry[]> {
  try {
    const ledgerRef = collection(requireDb(), "users", uid, "ledger");
    const q = query(ledgerRef, orderBy("createdAt", "desc"), fbLimit(limitCount));
    const snap = await withRetry(() => getDocs(q));

    const entries: LedgerEntry[] = [];
    for (const docSnap of snap.docs) {
      const data = docSnap.data();
      const createdAt = toDateOrNull(data.createdAt);
      if (!createdAt) continue;

      entries.push({
        id: docSnap.id,
        amount: typeof data.amount === "number" ? data.amount : 0,
        reason: typeof data.reason === "string" ? data.reason : "",
        createdAt,
        source: (data.source as "earned" | "bought" | "spent") ?? "earned",
        ref: typeof data.ref === "string" ? data.ref : null,
      });
    }

    return entries;
  } catch (err) {
    logger.warn("fetch_ledger_failed", { uid, error: parseFirebaseError(err) });
    return [];
  }
}
