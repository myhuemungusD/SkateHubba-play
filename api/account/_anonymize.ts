/**
 * Anonymization for records two people share.
 *
 * WHY ANONYMIZE INSTEAD OF DELETE: a dice match, a closet trade or a serial's
 * ownership history belongs to both sides. Deleting it on one person's request
 * would erase the other player's history (their wins, the trade that put an
 * item in their locker). So the departing account is replaced everywhere in
 * the record by a fixed tombstone: no uid, no username, nothing that points
 * back to the person. The other side keeps a record of "a match against a
 * deleted skater". When both sides are already gone, the record is deleted.
 */

/** Stands in for the departed uid in shared records. Never a real Auth uid (they are 28 chars, no dash). */
export const DELETED_UID = "deleted-user";

/** Stands in for the departed username in shared records. */
export const DELETED_NAME = "deleted skater";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/**
 * Deep copy of `value` with every occurrence of `uid` replaced by
 * {@link DELETED_UID}, both as a string value and as a map key (dice stores
 * per-seat maps keyed by uid). Non-plain objects (Timestamps, GeoPoints,
 * DocumentReferences) are passed through untouched so a rewrite never
 * corrupts a typed field.
 */
export function scrubUid(value: unknown, uid: string): unknown {
  if (value === uid) return DELETED_UID;
  if (Array.isArray(value)) return value.map((item) => scrubUid(item, uid));
  if (!isPlainObject(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) out[key === uid ? DELETED_UID : key] = scrubUid(inner, uid);
  return out;
}
