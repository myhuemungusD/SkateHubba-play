import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time `Authorization: Bearer ${CRON_SECRET}` check for the cron
 * handlers that use the Web `Request` signature (the WTT stubs). Same rules
 * as `isAuthorized` in the firebase-admin crons: fail-closed when CRON_SECRET
 * is unset or the header is missing/empty, and a length guard before
 * timingSafeEqual (which throws on unequal lengths), so only the secret's
 * length can leak through timing, never its bytes.
 */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const value = req.headers.get("authorization");
  if (!value) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(value);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
