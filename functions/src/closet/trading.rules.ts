/**
 * Pure trade checks. The client mirror (`src/services/closet.trading.ts`)
 * runs the same checks for instant feedback; this copy is the one enforced.
 */
import { TRADE_MAX_ITEMS } from "./economy.js";
import { asRarity, ClosetError, isId, num, str, toMillis, type Rarity } from "./model.js";

export const NOTE_MAX = 140;

const LINK = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|me|co|app|ly|xyz|link)\b)/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE = /(\d[\s\-().]*){7,}/;

/** Trade notes: short, and no links, emails or phone numbers (off-platform scams). */
export function cleanNote(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new ClosetError("bad_note");
  const note = raw.trim();
  if (note.length === 0) return null;
  if (note.length > NOTE_MAX || LINK.test(note) || EMAIL.test(note) || PHONE.test(note)) {
    throw new ClosetError("bad_note");
  }
  return note;
}

/** 1–4 distinct copy ids per side. Item-for-item only: neither side may be empty. */
export function copyIdList(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > TRADE_MAX_ITEMS) throw new ClosetError("bad_items");
  if (!raw.every(isId) || new Set(raw).size !== raw.length) throw new ClosetError("bad_items");
  return raw as string[];
}

export interface TradeItem {
  copyId: string;
  itemDefId: string;
  name: string;
  rarity: Rarity;
  serial: number | null;
}

export type ItemMode = "offer" | "release";

/**
 * Check one locker copy can move. "offer" (propose/confirm) requires it to be
 * unlocked and past its cooldown; "release" requires the lock to be this trade's.
 */
export function checkCopy(
  copyId: string,
  data: Record<string, unknown> | undefined,
  nowMs: number,
  mode: ItemMode,
  tradeId: string | null,
): TradeItem {
  if (!data) throw new ClosetError("item_gone");
  const lock = str(data.lockedByTrade);
  if (mode === "release" && lock !== tradeId) throw new ClosetError("item_locked");
  if (mode === "offer") {
    if (lock) throw new ClosetError("item_locked");
    const after = toMillis(data.tradableAfter);
    if (after !== null && after > nowMs) throw new ClosetError("item_cooldown");
  }
  return {
    copyId,
    itemDefId: str(data.itemDefId),
    name: str(data.name),
    rarity: asRarity(data.rarity) ?? "common",
    serial: typeof data.serial === "number" ? num(data.serial) : null,
  };
}
