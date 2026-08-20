/**
 * Account bans for the moderator console.
 *
 * Split out of `admin.ts` rather than appended to it: that file is already
 * over the 400 LOC service budget, and bans are a self-contained concern
 * (one field, two verbs, one rule clause).
 *
 * Authorization is the `admin` custom claim, enforced by `firestore.rules`
 * on `users/{uid}` — this module assumes that gate and does not re-implement
 * it. A client-side admin check is a UI affordance, never an authorization
 * decision. See the header of `admin.ts` for the full posture.
 *
 * What the flag does
 * ──────────────────
 * `users/{uid}.banned == true` closes every UGC-producing write path in the
 * rules — user clips, clip votes, clip comments — while leaving READ access
 * intact, so a banned skater sees a normal app that silently refuses to
 * accept their content. It deliberately does NOT block game writes: the
 * /games rules already sit near the per-request document-access ceiling and
 * adding a profile `get()` to every turn would tip them over. Accepted gap
 * (documented in firestore.rules): a banned user can finish an in-flight
 * game. Their feed presence is what moderation actually revokes.
 *
 * Unbanning writes `banned: false` rather than deleting the field, so the
 * two states are both explicit — "never banned" and "banned then cleared"
 * read the same to the rules but differently to a human reading the doc.
 *
 * Payload exactness
 * ─────────────────
 * `banned` is the ONLY key written. The `users` update rule pins the
 * affected-key set on every clause, so an audit pair (`bannedBy`/`bannedAt`,
 * as `setVerifiedPro` writes) would need a matching rules change first;
 * until then adding one would turn every ban into a `permission-denied`.
 * The acting admin is recorded in the log line below, not in the doc.
 */

import { doc, runTransaction } from "firebase/firestore";
import { requireDb } from "../firebase";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";

/** Mirrors `admin.ts` → `isValidUid`: a path segment must be usable. */
function requireUid(uid: string): void {
  if (typeof uid !== "string" || uid.length === 0 || uid.includes("/")) {
    throw new Error("Invalid target uid.");
  }
}

/**
 * Flip the ban flag inside a transaction.
 *
 * A transaction rather than a bare `updateDoc` for the same reason
 * `setVerifiedPro` uses one: the pre-read is the only thing that
 * distinguishes "banned the right account" from "created a stray field on a
 * mistyped uid" — `update` on a missing doc fails with an opaque
 * `not-found`.
 *
 * Writes EXACTLY `{ banned }` — see the payload note in the file header.
 */
async function setBanned(targetUid: string, banned: boolean): Promise<void> {
  requireUid(targetUid);

  const db = requireDb();
  const userRef = doc(db, "users", targetUid);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error("That skater's profile no longer exists.");
      tx.update(userRef, { banned });
    });
  } catch (err) {
    logger.warn("admin_ban_write_failed", { targetUid, banned, error: parseFirebaseError(err) });
    throw err;
  }
}

/** Ban `uid` — closes their UGC write paths. Idempotent. */
export async function banUser(uid: string): Promise<void> {
  return setBanned(uid, true);
}

/** Lift the ban on `uid`. Idempotent. */
export async function unbanUser(uid: string): Promise<void> {
  return setBanned(uid, false);
}
