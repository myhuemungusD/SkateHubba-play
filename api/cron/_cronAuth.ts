import { timingSafeEqual } from "node:crypto";

/**
 * Shared cron auth: the one constant-time check of an Authorization header
 * value against `Bearer ${CRON_SECRET}`. Used by every cron under api/cron
 * (the "_" prefix keeps this file from being deployed as a function).
 *
 * Fail-closed: returns false when CRON_SECRET is unset or empty, or the value
 * is undefined or empty. timingSafeEqual throws on unequal-length buffers, so
 * we length-guard first; the length check is not constant-time but only leaks
 * the secret's length, never its bytes.
 */
export function matchesCronSecret(value: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (!value) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(value);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/** Cron auth for handlers that use the Web `Request` signature (the WTT stubs). */
export function isCronAuthorized(req: Request): boolean {
  return matchesCronSecret(req.headers.get("authorization") ?? undefined);
}
