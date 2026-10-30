/**
 * Closet drops service — weekly limited releases with server-authoritative stock.
 * Reads drop state; mutations go through Cloud Functions callables.
 */
import { doc, getDoc, collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { requireDb } from "../firebase";
import { callCloset } from "./closet.callable";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";
import { toDateOrNull } from "./firestoreDate";
import { trackEvent } from "./analytics";

export interface Drop {
  id: string;
  itemDefId: string;
  startsAt: Date;
  endsAt: Date;
  drawEntryWindowEndsAt: Date | null;
  stock: number;
  claimed: number;
  requiresGames: number;
  requiresAccountDays: number;
  isLive: boolean;
  isSoldOut: boolean;
  isDraw: boolean;
}

export interface DropClaim {
  claimedAt: Date;
  serial: number;
  copyId: string;
}

export interface DrawEntry {
  enteredAt: Date;
  eligible: boolean;
}

function parseDropDoc(id: string, data: Record<string, unknown>): Drop | null {
  const startsAt = toDateOrNull(data.startsAt);
  const endsAt = toDateOrNull(data.endsAt);
  if (!startsAt || !endsAt) return null;

  const now = Date.now();
  const isLive = startsAt.getTime() <= now && now < endsAt.getTime();
  const claimed = typeof data.claimed === "number" ? data.claimed : 0;
  const stock = typeof data.stock === "number" ? data.stock : 0;

  return {
    id,
    itemDefId: typeof data.itemDefId === "string" ? data.itemDefId : "",
    startsAt,
    endsAt,
    drawEntryWindowEndsAt: toDateOrNull(data.drawEntryWindowEndsAt),
    stock,
    claimed,
    requiresGames: typeof data.requiresGames === "number" ? data.requiresGames : 0,
    requiresAccountDays: typeof data.requiresAccountDays === "number" ? data.requiresAccountDays : 0,
    isLive,
    isSoldOut: claimed >= stock,
    isDraw: data.drawEntryWindowEndsAt !== undefined && data.drawEntryWindowEndsAt !== null,
  };
}

/**
 * Fetch one drop by id. Returns null if not found.
 */
export async function fetchDrop(dropId: string): Promise<Drop | null> {
  try {
    const snap = await withRetry(() => getDoc(doc(requireDb(), "drops", dropId)));
    const data = snap.data();
    if (!data) return null;
    return parseDropDoc(snap.id, data);
  } catch (err) {
    logger.warn("fetch_drop_failed", { dropId, error: parseFirebaseError(err) });
    return null;
  }
}

/**
 * Fetch all active or upcoming drops (not ended yet).
 * Returns drops sorted by start time (soonest first).
 */
export async function fetchActiveDrops(): Promise<Drop[]> {
  try {
    const dropsRef = collection(requireDb(), "drops");
    const now = new Date();
    const q = query(dropsRef, where("endsAt", ">", now), orderBy("endsAt", "asc"));

    const snap = await withRetry(() => getDocs(q));
    const drops: Drop[] = [];

    for (const docSnap of snap.docs) {
      const parsed = parseDropDoc(docSnap.id, docSnap.data());
      if (parsed) drops.push(parsed);
    }

    return drops;
  } catch (err) {
    logger.warn("fetch_active_drops_failed", { error: parseFirebaseError(err) });
    return [];
  }
}

/**
 * Check if the current user has claimed a drop.
 */
export async function fetchDropClaim(dropId: string, uid: string): Promise<DropClaim | null> {
  try {
    const snap = await withRetry(() => getDoc(doc(requireDb(), "drops", dropId, "claims", uid)));
    const data = snap.data();
    if (!data) return null;

    return {
      claimedAt: toDateOrNull(data.claimedAt) ?? new Date(),
      serial: typeof data.serial === "number" ? data.serial : 0,
      copyId: typeof data.copyId === "string" ? data.copyId : "",
    };
  } catch (err) {
    logger.warn("fetch_drop_claim_failed", { dropId, uid, error: parseFirebaseError(err) });
    return null;
  }
}

/**
 * Check if the current user has entered a draw.
 */
export async function fetchDrawEntry(dropId: string, uid: string): Promise<DrawEntry | null> {
  try {
    const snap = await withRetry(() => getDoc(doc(requireDb(), "drops", dropId, "entries", uid)));
    const data = snap.data();
    if (!data) return null;

    return {
      enteredAt: toDateOrNull(data.enteredAt) ?? new Date(),
      eligible: data.eligible === true,
    };
  } catch (err) {
    logger.warn("fetch_draw_entry_failed", { dropId, uid, error: parseFirebaseError(err) });
    return null;
  }
}

/**
 * Claim a drop (first-come, first-served Limited drops).
 * Throws on failure (already claimed, sold out, not eligible, etc.).
 */
export async function claimDrop(dropId: string): Promise<{ copyId: string; serial: number }> {
  try {
    const data = await callCloset<{ dropId: string }, { copyId: string; serial: number }>("claimDrop", { dropId });
    trackEvent("closet_drop_claimed", { dropId });
    return data;
  } catch (err) {
    logger.warn("claim_drop_failed", { dropId, error: parseFirebaseError(err) });
    throw err;
  }
}

/**
 * Enter a draw for a Grail drop. Free to enter, earned eligibility.
 * Throws on failure (already entered, not eligible, draw closed, etc.).
 */
export async function enterDraw(dropId: string): Promise<void> {
  try {
    await callCloset<{ dropId: string }, void>("enterDraw", { dropId });
    trackEvent("closet_draw_entered", { dropId });
  } catch (err) {
    logger.warn("enter_draw_failed", { dropId, error: parseFirebaseError(err) });
    throw err;
  }
}
