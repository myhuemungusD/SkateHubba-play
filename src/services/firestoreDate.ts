/**
 * Convert a Firestore Timestamp-shaped field into a `Date`. Uses structural
 * duck-typing on `.toDate()` rather than `instanceof Timestamp` — the latter
 * is brittle across multiple SDK instances and across the test module mock.
 * Anything that isn't a resolvable Timestamp becomes `null`.
 */
export function toDateOrNull(value: unknown): Date | null {
  if (!value || typeof value !== "object") return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return null;
  const date: unknown = toDate.call(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date;
}
