/**
 * Account bans for the moderator console.
 *
 * Split out of `admin.ts` rather than appended to it: that file is already
 * over the 400 LOC service budget, and bans are a self-contained concern.
 *
 * Authorization is the `admin` custom claim, enforced by `firestore.rules`
 * on both paths written here — this module assumes that gate and does not
 * re-implement it. A client-side admin check is a UI affordance, never an
 * authorization decision. See the header of `admin.ts` for the full posture.
 *
 * Where a ban actually lives
 * ──────────────────────────
 * The AUTHORITATIVE record is a tombstone doc at `bans/{uid}`. Its mere
 * existence is the ban: `notBanned()` in the rules is a single `exists()`
 * against it, and every UGC write path (user clips, clipVotes, clip
 * comments) is gated on that.
 *
 * It is NOT a field on the profile, and that distinction is load-bearing.
 * `users/{uid}` is owner-deletable and owner-recreatable, so a flag stored
 * there was shed by deleting the account and signing up again on the same
 * UID — the profile create rule forbids seeding `banned`, so the account
 * came back clean. `bans/{uid}` is unreachable by its subject in every verb
 * except `get` (so a client can explain why a write was refused), which is
 * why a ban survives profile deletion, re-signup and username changes.
 *
 * `users/{uid}.banned` is kept in sync here as a DISPLAY MIRROR for the
 * console and profile badges. Never gate a write on it.
 *
 * Payload exactness
 * ─────────────────
 * The `bans` create rule pins the key set to exactly
 * `['bannedBy', 'bannedAt', 'reason']`, requires `bannedBy` to be the
 * CALLER's own uid, and requires `bannedAt == request.time`. A drifted
 * payload fails at runtime as `permission-denied`, not at compile time, so
 * the shape is asserted field-by-field in `__tests__/admin.bans.test.ts`.
 *
 * Ban docs are immutable (`allow update: if false`) so the audit trail can
 * neither be re-attributed to another moderator nor back-dated. Re-banning
 * is delete-then-create, which re-stamps both fields — {@link unbanUser}
 * followed by {@link banUser}, never an edit.
 *
 * Four-eyes: the rules refuse both verbs when `uid == request.auth.uid`, so
 * a single compromised admin token cannot ban a rival moderator's subject
 * and then quietly clear its own record. Guarded here too, to fail with a
 * legible message instead of an opaque rejection.
 */

import { deleteDoc, doc, serverTimestamp, updateDoc, writeBatch } from "firebase/firestore";
import { requireAuth, requireDb } from "../firebase";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";

/** Cap on the audit note, mirroring the create rule's `size() <= 500`. */
const MAX_REASON_LEN = 500;

/** Mirrors `admin.ts` → `isValidUid`: a path segment must be usable. */
function requireUid(uid: string): void {
  if (typeof uid !== "string" || uid.length === 0 || uid.includes("/")) {
    throw new Error("Invalid target uid.");
  }
}

/**
 * The acting admin's uid, and the four-eyes guard.
 *
 * `bannedBy` is pinned by the rules to `request.auth.uid`, so it is read
 * from auth rather than accepted as a parameter: a caller-supplied value
 * could only ever build a write that cannot succeed.
 */
function requireActingAdmin(targetUid: string): string {
  const adminUid = requireAuth().currentUser?.uid;
  if (!adminUid) throw new Error("You must be signed in to moderate.");
  if (adminUid === targetUid) throw new Error("You cannot ban or unban your own account.");
  return adminUid;
}

/**
 * Commit a ban/unban, falling back to the tombstone alone when the profile
 * mirror cannot be written.
 *
 * The mirror is an `update`, which requires `users/{uid}` to exist. A
 * subject who deleted their profile — precisely the bypass this whole
 * collection exists to close — has no doc to update, and the rules reject
 * an update against a missing document, taking the ENTIRE batch (tombstone
 * included) down with it. Retrying with just the tombstone means the
 * enforcement record still lands; the mirror is display-only and can be
 * reconciled whenever the profile reappears.
 *
 * The fallback triggers on `permission-denied` as well as `not-found`
 * because that is the code Firestore surfaces for an update against a
 * missing doc (the rule's `resource.data` diff cannot be evaluated). A
 * genuinely unauthorized caller therefore burns one extra doomed round-trip
 * before the retry fails too and the original error is rethrown — a rare
 * price for never silently failing to ban someone.
 */
async function commitWithTombstoneFallback(
  targetUid: string,
  commitBoth: () => Promise<void>,
  commitTombstoneOnly: () => Promise<void>,
  event: string,
): Promise<void> {
  try {
    await commitBoth();
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== "permission-denied" && code !== "not-found") {
      logger.warn(event, { targetUid, error: parseFirebaseError(err) });
      throw err;
    }
    try {
      await commitTombstoneOnly();
      // The ban itself is in force; only the cosmetic flag is stale.
      logger.warn("admin_ban_mirror_skipped", { targetUid, error: parseFirebaseError(err) });
    } catch {
      // The retry failed too — the caller was genuinely refused. Report the
      // original failure, which is the one that describes the real attempt.
      logger.warn(event, { targetUid, error: parseFirebaseError(err) });
      throw err;
    }
  }
}

/**
 * Ban `uid`: write the `bans/{uid}` tombstone and mirror the flag onto the
 * profile, in one atomic batch.
 *
 * `reason` is an optional moderator note. When absent the key is OMITTED
 * rather than written as `null` or `""` — the create rule's
 * `keys().hasOnly([...])` permits its absence but its type guard rejects a
 * non-string, so a null would fail the write.
 *
 * Idempotent from the operator's point of view only in the sense that a
 * re-ban of an already-banned account is REJECTED (ban docs are immutable).
 * To re-stamp the audit trail, unban first.
 */
export async function banUser(uid: string, reason?: string): Promise<void> {
  requireUid(uid);
  const adminUid = requireActingAdmin(uid);

  const trimmedReason = typeof reason === "string" ? reason.trim() : "";
  if (trimmedReason.length > MAX_REASON_LEN) {
    throw new Error(`Too long — reason must be ${MAX_REASON_LEN} characters or fewer.`);
  }

  const db = requireDb();
  const banRef = doc(db, "bans", uid);
  const userRef = doc(db, "users", uid);

  // Built once and reused by both commit attempts so the tombstone payload
  // cannot drift between the batched and fallback paths.
  const payload: { bannedBy: string; bannedAt: unknown; reason?: string } = {
    bannedBy: adminUid,
    bannedAt: serverTimestamp(),
  };
  if (trimmedReason.length > 0) payload.reason = trimmedReason;

  await commitWithTombstoneFallback(
    uid,
    async () => {
      const batch = writeBatch(db);
      batch.set(banRef, payload);
      // Field-scoped: the mirror clause is `hasOnly(['banned'])`, so a ban
      // can never ride along with any other profile change.
      batch.update(userRef, { banned: true });
      await batch.commit();
    },
    async () => {
      const batch = writeBatch(db);
      batch.set(banRef, payload);
      await batch.commit();
    },
    "admin_ban_write_failed",
  );
}

/**
 * Lift the ban on `uid`: delete the tombstone and clear the profile mirror,
 * in one atomic batch.
 *
 * Deleting a tombstone that isn't there is not an error, so an unban of an
 * unbanned account is a no-op rather than a failure — which is what a
 * moderator clearing a stale mirror expects.
 *
 * The mirror is written as `banned: false` rather than removed so the two
 * states stay explicit: "never banned" and "banned then cleared" read the
 * same to the rules but differently to a human reading the doc.
 */
export async function unbanUser(uid: string): Promise<void> {
  requireUid(uid);
  requireActingAdmin(uid);

  const db = requireDb();
  const banRef = doc(db, "bans", uid);
  const userRef = doc(db, "users", uid);

  await commitWithTombstoneFallback(
    uid,
    async () => {
      const batch = writeBatch(db);
      batch.delete(banRef);
      batch.update(userRef, { banned: false });
      await batch.commit();
    },
    // Deliberately a bare delete, not a one-op batch: the enforcement
    // record is all that has to go, and `deleteDoc` says so plainly.
    async () => {
      await deleteDoc(banRef);
    },
    "admin_unban_write_failed",
  );
}

/**
 * Clear a stale `users/{uid}.banned` mirror on its own.
 *
 * The escape hatch for the case {@link commitWithTombstoneFallback}
 * creates: a subject whose profile was missing at ban time, then
 * reappeared, carries no mirror even though the tombstone is in force (or
 * the reverse, after an unban). Enforcement is unaffected either way — this
 * only repairs what the console displays.
 */
export async function syncBanMirror(uid: string, banned: boolean): Promise<void> {
  requireUid(uid);
  requireActingAdmin(uid);

  try {
    await updateDoc(doc(requireDb(), "users", uid), { banned });
  } catch (err) {
    logger.warn("admin_ban_mirror_sync_failed", { targetUid: uid, banned, error: parseFirebaseError(err) });
    throw err;
  }
}
