/**
 * Closet trading service — item-for-item trades with Steam-style holds and fraud protection.
 * All mutations go through Cloud Functions callables.
 */
import { doc, getDoc, collection, getDocs, query, where, orderBy, limit as fbLimit } from "firebase/firestore";
import { requireDb } from "../firebase";
import { callCloset } from "./closet.callable";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";
import { toDateOrNull } from "./closet.time";
import { trackEvent } from "./analytics";

export type TradeStatus = "proposed" | "accepted" | "declined" | "canceled" | "held" | "complete";

export interface TradeItem {
  copyId: string;
  name: string;
  rarity: string;
  imageUrl: string | null;
}

export interface Trade {
  id: string;
  proposerUid: string;
  recipientUid: string;
  proposerItems: TradeItem[];
  recipientItems: TradeItem[];
  status: TradeStatus;
  note: string | null;
  proposedAt: Date;
  respondedAt: Date | null;
  completedAt: Date | null;
  holdUntil: Date | null;
}

function parseTradeDoc(id: string, data: Record<string, unknown>): Trade | null {
  const proposedAt = toDateOrNull(data.proposedAt);
  if (!proposedAt) return null;

  return {
    id,
    proposerUid: typeof data.proposerUid === "string" ? data.proposerUid : "",
    recipientUid: typeof data.recipientUid === "string" ? data.recipientUid : "",
    proposerItems: Array.isArray(data.proposerItems) ? (data.proposerItems as TradeItem[]) : [],
    recipientItems: Array.isArray(data.recipientItems) ? (data.recipientItems as TradeItem[]) : [],
    status: (data.status as TradeStatus) ?? "proposed",
    note: typeof data.note === "string" ? data.note : null,
    proposedAt,
    respondedAt: toDateOrNull(data.respondedAt),
    completedAt: toDateOrNull(data.completedAt),
    holdUntil: toDateOrNull(data.holdUntil),
  };
}

/**
 * Fetch one trade by id. Returns null if not found or user is not a party.
 */
export async function fetchTrade(tradeId: string): Promise<Trade | null> {
  try {
    const snap = await withRetry(() => getDoc(doc(requireDb(), "trades", tradeId)));
    const data = snap.data();
    if (!data) return null;
    return parseTradeDoc(snap.id, data);
  } catch (err) {
    logger.warn("fetch_trade_failed", { tradeId, error: parseFirebaseError(err) });
    return null;
  }
}

/**
 * Fetch trades involving the current user.
 * Returns trades sorted by proposal time (newest first).
 */
export async function fetchUserTrades(uid: string, statusFilter?: TradeStatus): Promise<Trade[]> {
  try {
    const tradesRef = collection(requireDb(), "trades");
    let q = query(tradesRef, where("proposerUid", "==", uid), orderBy("proposedAt", "desc"), fbLimit(50));

    if (statusFilter) {
      q = query(
        tradesRef,
        where("proposerUid", "==", uid),
        where("status", "==", statusFilter),
        orderBy("proposedAt", "desc"),
        fbLimit(50),
      );
    }

    const proposerSnap = await withRetry(() => getDocs(q));

    q = query(tradesRef, where("recipientUid", "==", uid), orderBy("proposedAt", "desc"), fbLimit(50));
    if (statusFilter) {
      q = query(
        tradesRef,
        where("recipientUid", "==", uid),
        where("status", "==", statusFilter),
        orderBy("proposedAt", "desc"),
        fbLimit(50),
      );
    }

    const recipientSnap = await withRetry(() => getDocs(q));

    const trades: Trade[] = [];
    for (const docSnap of [...proposerSnap.docs, ...recipientSnap.docs]) {
      const parsed = parseTradeDoc(docSnap.id, docSnap.data());
      if (parsed) trades.push(parsed);
    }

    return trades.sort((a, b) => b.proposedAt.getTime() - a.proposedAt.getTime());
  } catch (err) {
    logger.warn("fetch_user_trades_failed", { uid, error: parseFirebaseError(err) });
    return [];
  }
}

export interface ProposeTradeParams {
  recipientUid: string;
  proposerCopyIds: string[];
  recipientCopyIds: string[];
  note?: string;
  counterToTradeId?: string;
}

/**
 * Propose a new trade or counter an existing one.
 * Throws on failure (bad items, rate limit, etc.).
 */
export async function proposeTrade(params: ProposeTradeParams): Promise<{ tradeId: string }> {
  try {
    const data = await callCloset<ProposeTradeParams, { tradeId: string }>("proposeTrade", params);
    trackEvent("closet_trade_proposed", { tradeId: data.tradeId });
    return data;
  } catch (err) {
    logger.warn("propose_trade_failed", { error: parseFirebaseError(err) });
    throw err;
  }
}

export type TradeResponse = "accept" | "decline" | "cancel" | "counter";

export interface RespondTradeParams {
  tradeId: string;
  response: TradeResponse;
  proposerCopyIds?: string[];
  recipientCopyIds?: string[];
  note?: string;
}

/**
 * Respond to a trade: accept, decline, cancel, or counter.
 * Throws on failure (not a party, invalid state, etc.).
 */
export async function respondTrade(params: RespondTradeParams): Promise<void> {
  try {
    await callCloset<RespondTradeParams, void>("respondTrade", params);
    trackEvent("closet_trade_responded", { tradeId: params.tradeId, response: params.response });
  } catch (err) {
    logger.warn("respond_trade_failed", { tradeId: params.tradeId, error: parseFirebaseError(err) });
    throw err;
  }
}

/**
 * Confirm a trade after both parties have accepted.
 * This starts the hold period if security requirements aren't met.
 * Throws on failure (not accepted, already confirmed, etc.).
 */
export async function confirmTrade(tradeId: string): Promise<void> {
  try {
    await callCloset<{ tradeId: string }, void>("confirmTrade", { tradeId });
    trackEvent("closet_trade_confirmed", { tradeId });
  } catch (err) {
    logger.warn("confirm_trade_failed", { tradeId, error: parseFirebaseError(err) });
    throw err;
  }
}
