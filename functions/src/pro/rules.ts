/**
 * Pure rules for pro blessings. A pro badge is never earned or won: the
 * only way in is an existing verified pro blessing you, and you accepting.
 * Admin seeding (founder) is the one exception and lives in the admin panel.
 */
export interface BlessingConfig {
  /** Blessings one pro may hand out per rolling window. */
  limit: number;
  windowDays: number;
  /** The blessed skater's account must be at least this old. */
  minAccountAgeDays: number;
  /** A pending blessing lapses after this many days. */
  offerTtlDays: number;
}

export const DEFAULT_BLESSING_CONFIG: BlessingConfig = {
  limit: 2,
  windowDays: 30,
  minAccountAgeDays: 30,
  offerTtlDays: 14,
};

export const REASON_MIN = 10;
export const REASON_MAX = 280;
export const DAY_MS = 24 * 60 * 60 * 1000;

export type BlessingStatus = "pending" | "accepted" | "declined" | "expired" | "revoked";

/** Firestore Timestamp, Date, or millis to millis. Null when unreadable. */
export function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) return value.getTime();
  if (value && typeof value === "object" && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    const ms = (value as { toMillis: () => number }).toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** Trimmed, whitespace-collapsed reason, or null when it is out of bounds. */
export function cleanReason(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < REASON_MIN || text.length > REASON_MAX) return null;
  return text;
}

export function accountOldEnough(createdAt: unknown, nowMs: number, minDays: number): boolean {
  const ms = toMillis(createdAt);
  if (ms === null) return false;
  return nowMs - ms >= minDays * DAY_MS;
}

/** Count blessings that use up quota inside the window. Declined offers still count. */
export function blessingsInWindow(createdAts: unknown[], nowMs: number, windowDays: number): number {
  const floor = nowMs - windowDays * DAY_MS;
  return createdAts.filter((value) => {
    const ms = toMillis(value);
    return ms !== null && ms >= floor;
  }).length;
}

export function offerExpired(createdAt: unknown, nowMs: number, ttlDays: number): boolean {
  const ms = toMillis(createdAt);
  return ms === null || nowMs - ms > ttlDays * DAY_MS;
}
