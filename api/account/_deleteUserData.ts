/**
 * Admin-credential erasure cascade for a single account.
 *
 * WHY THIS EXISTS: the client-side cascade it replaces could never run. The
 * previous flow deleted the Firebase Auth user first and then asked the
 * *just-deleted* user's SDK to wipe their own Firestore data. But
 * `User.delete()` ends with `auth.signOut()` and clears the refresh token, so
 * by the time the cascade started, `auth.currentUser` was null and the token
 * provider returned null. Every rule on the cascade path requires
 * `request.auth != null`, so the very first query failed `permission-denied` —
 * before a single document was deleted. `withRetry` did not help either:
 * `permission-denied` and `unauthenticated` are both classified permanent, so
 * there was exactly one attempt. The net effect was that every deletion left
 * 100% of the user's personal data behind while reporting success.
 *
 * Running the cascade with admin credentials removes the dependency on the
 * caller's (now revoked) token entirely. Rules are bypassed, so the ordering
 * constraints the old code worked around — delete the private doc before its
 * parent, scrub pushTargets before `users/{uid}` — no longer apply for
 * authorization reasons. They are preserved anyway, because the ordering is
 * also what makes a partial run safe to resume.
 *
 * GUARDRAIL NOTE: this rides the same approved bend of the "no custom backend"
 * rule as `api/cron/sweep-expired-turns.ts` and `api/cron/drain-push-dispatch.ts`
 * (repo owner sign-off), and reuses that surface's admin bootstrap rather than
 * adding anything under `functions/src/`.
 *
 * Design properties:
 *   • Idempotent. Deleting an already-deleted doc is a no-op in Firestore, and
 *     every query re-reads current state, so a failed run can simply be retried.
 *   • Fail-loud. Any phase that fails throws, and the caller then does NOT
 *     delete the Auth user. The account stays usable and the user can retry —
 *     the opposite of the old contract, which reported success on total failure.
 *   • Scope-preserving. This deletes exactly what the client cascade intended to
 *     delete, no more. Admin credentials *could* reach further (e.g. disputes
 *     other people raised about this user), but widening erasure to other
 *     users' documents is a product decision, not a bug fix.
 */

import { FieldPath, type Firestore, type Query } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";

/** Owner-only canonical doc under `users/{uid}/private` — mirrors users.ts. */
const PRIVATE_PROFILE_DOC_ID = "profile";

/** Avatar extensions written by `src/services/avatars.ts`. */
const AVATAR_EXTENSIONS = ["webp", "jpeg", "png"] as const;

/**
 * Firestore caps a batch at 500 writes. 400 leaves headroom so a future extra
 * delete per entity can't silently push a previously-fine account over the line.
 */
const BATCH_CHUNK = 400;

/**
 * Max docs pulled per query page. Deletion is unbounded in principle (a heavy
 * user can have thousands of notifications), so every scan paginates rather
 * than assuming one `get()` returns everything.
 */
const PAGE_SIZE = 500;

/** Concurrent Storage deletes. Bounded so a large account can't self-DoS on GCS limits. */
const STORAGE_DELETE_CONCURRENCY = 20;

/** Attempts per Storage object before giving up (transient codes only). */
const STORAGE_RETRY_ATTEMPTS = 3;

/** Base backoff between Storage retries; doubles per attempt. */
const STORAGE_RETRY_BASE_MS = 200;

/** Per-collection counts, returned to the caller for logging and the response body. */
export interface DeletionSummary {
  games: number;
  gameVideoObjects: number;
  clips: number;
  clipVotes: number;
  disputes: number;
  disputeVotes: number;
  notifications: number;
  pushTargets: number;
  pushDispatch: number;
  nudges: number;
  reports: number;
  achievements: number;
  blockedUsers: number;
  avatarObjects: number;
  usernameReleased: boolean;
}

/** Everything the cascade needs, injected so the unit tests can drive it with fakes. */
export interface CascadeDeps {
  db: Firestore;
  storage: Storage;
  /** Bucket name, e.g. `my-project.firebasestorage.app`. */
  bucketName: string;
}

function emptySummary(): DeletionSummary {
  return {
    games: 0,
    gameVideoObjects: 0,
    clips: 0,
    clipVotes: 0,
    disputes: 0,
    disputeVotes: 0,
    notifications: 0,
    pushTargets: 0,
    pushDispatch: 0,
    nudges: 0,
    reports: 0,
    achievements: 0,
    blockedUsers: 0,
    avatarObjects: 0,
    usernameReleased: false,
  };
}

/**
 * Page through a query by document id, collecting every matching doc.
 *
 * Ordering by `__name__` gives a stable cursor that does not require a
 * composite index (a `where(...) + orderBy(otherField)` pair would). The loop
 * terminates when a page comes back short of `PAGE_SIZE`.
 */
async function scanAll(base: Query): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const out: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let page = base.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const snap = await page.get();
    out.push(...snap.docs);
    if (snap.size < PAGE_SIZE) return out;
    cursor = snap.docs[snap.size - 1];
  }
}

/**
 * Delete a user's votes from `voteCollection`, decrementing the denormalized
 * tally on each parent document in the same transaction.
 *
 * Both vote collections in this codebase share the shape: the vote names its
 * parent by id, and the parent carries a count that ranking reads. Deleting the
 * vote without the decrement permanently inflates that count, so the pair has
 * to be atomic. `fieldFor` picks which counter to decrement (clips have one;
 * disputes have one per verdict) and returns null when the vote is unusable.
 */
async function deleteVotes(
  db: Firestore,
  voteCollection: string,
  parentCollection: string,
  parentIdField: string,
  fieldFor: (data: Record<string, unknown>) => string | null,
  uid: string,
): Promise<number> {
  const votes = await scanAll(db.collection(voteCollection).where("uid", "==", uid));
  for (const voteDoc of votes) {
    const data = voteDoc.data() as Record<string, unknown>;
    const rawId = data[parentIdField];
    const parentId = typeof rawId === "string" && rawId.length > 0 ? rawId : null;
    const field = fieldFor(data);
    await db.runTransaction(async (tx) => {
      // No usable parent or counter — drop the vote, skip the tally.
      if (parentId === null || field === null) {
        tx.delete(voteDoc.ref);
        return;
      }
      const parentRef = db.collection(parentCollection).doc(parentId);
      const parentSnap = await tx.get(parentRef);
      tx.delete(voteDoc.ref);
      // Parent already gone: nothing left to keep consistent.
      if (!parentSnap.exists) return;
      const current = (parentSnap.data() as Record<string, unknown>)[field];
      const count = typeof current === "number" && Number.isFinite(current) ? current : 0;
      // Never write a negative count — a drifted or zero aggregate has nothing
      // to subtract.
      if (count <= 0) return;
      tx.update(parentRef, { [field]: count - 1 });
    });
  }
  return votes.length;
}

/** Delete refs in chunked batches, staying under the 500-write ceiling. */
async function deleteRefs(db: Firestore, refs: FirebaseFirestore.DocumentReference[]): Promise<number> {
  for (let i = 0; i < refs.length; i += BATCH_CHUNK) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_CHUNK)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
}

/**
 * Read the account's username so the reservation in `/usernames` can be released.
 *
 * SECURITY: reading this from the profile is NOT sufficient on its own, and the
 * reservation must never be deleted on the strength of this value alone.
 * `firestore.rules` lets any signed-in user create `users/{uid}` with any
 * format-valid username and does NOT require that a matching reservation is
 * actually held (`match /users/{uid}`, `allow create`). So an attacker can sign
 * up, write `users/{attacker}` claiming a victim's username without ever
 * reserving it, and then invoke deletion. The client cascade was safe from this
 * by accident: `usernames/{name}` delete requires
 * `resource.data.uid == request.auth.uid`, so the batch was simply rejected.
 * Admin credentials bypass that rule, which turns an accidental safeguard into
 * a username-hijack primitive.
 *
 * The ownership check therefore lives in `releaseUsername` below, and this
 * function returns a *candidate* only.
 *
 * Returns null when the profile is already gone (a resumed run), in which case
 * the reservation was either freed on the previous attempt or never held.
 */
export async function readUsername(db: Firestore, uid: string): Promise<string | null> {
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return null;
  const raw = (snap.data() as Record<string, unknown> | undefined)?.username;
  if (typeof raw !== "string") return null;
  const normalized = raw.toLowerCase().trim();
  return normalized.length > 0 ? normalized : null;
}

/**
 * Release `usernames/{candidate}` only if it is genuinely held by `uid`.
 *
 * Read and delete happen in one transaction so another account cannot claim the
 * reservation between the ownership check and the delete — otherwise the
 * check would pass against the old holder and the delete would land on the new
 * one, reintroducing the hijack through a narrower window.
 *
 * Returns true when a reservation was actually released.
 */
async function releaseUsername(db: Firestore, uid: string, candidate: string): Promise<boolean> {
  const ref = db.collection("usernames").doc(candidate);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    // Not held at all (resumed run, or never reserved) — nothing to release.
    if (!snap.exists) return false;
    // Held by someone else: the profile was claiming a username it never owned.
    // Leave the real owner's reservation alone.
    if ((snap.data() as Record<string, unknown> | undefined)?.uid !== uid) return false;
    tx.delete(ref);
    return true;
  });
}

/**
 * Delete every object under a Storage prefix.
 *
 * `deleteFiles` paginates internally. A missing prefix is not an error — it
 * resolves with nothing deleted, which is exactly the resumed-run case.
 */
async function deletePrefix(deps: CascadeDeps, prefix: string): Promise<number> {
  const bucket = deps.storage.bucket(deps.bucketName);
  const [files] = await bucket.getFiles({ prefix });
  // Bounded fan-out. A heavy account (many finished games x turns) can hold
  // hundreds of objects; firing every delete at once invites GCS rate limits,
  // and because this phase runs first, a single 429 would abort the cascade
  // before any Firestore document is touched — every retry replaying the same
  // burst. Chunking keeps a big account deletable.
  for (let i = 0; i < files.length; i += STORAGE_DELETE_CONCURRENCY) {
    const chunk = files.slice(i, i + STORAGE_DELETE_CONCURRENCY);
    await Promise.all(chunk.map((f) => withStorageRetry(() => f.delete({ ignoreNotFound: true }))));
  }
  return files.length;
}

/**
 * Retry a Storage operation through transient GCS failures.
 *
 * Deliberately narrow: only rate-limit and availability codes retry. A
 * permissions or bad-bucket failure must still throw, because silently
 * continuing would erase the Firestore records while leaving the binaries —
 * the exact privacy failure this cascade exists to prevent.
 */
async function withStorageRetry<T>(op: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < STORAGE_RETRY_ATTEMPTS; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: unknown } | null)?.code;
      const retryable = code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
      if (!retryable || attempt === STORAGE_RETRY_ATTEMPTS - 1) throw err;
      await new Promise((r) => setTimeout(r, STORAGE_RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw lastErr;
}

/**
 * Erase all data belonging to `uid`.
 *
 * Phase order is deliberate and must not be rearranged casually. It is the same
 * order the client cascade used, for a different reason: rules no longer force
 * it, but it still means an interrupted run leaves the *identity* documents
 * (`users/{uid}`, the username reservation) alive longest. Those are what a
 * retry needs in order to find the rest, so a crash mid-cascade stays
 * recoverable instead of stranding orphans nothing can locate.
 *
 * Throws on the first phase that fails. The caller must not delete the Auth
 * user unless this resolves.
 */
export async function deleteUserDataAsAdmin(deps: CascadeDeps, uid: string): Promise<DeletionSummary> {
  const { db } = deps;
  const summary = emptySummary();

  // ── Phase 0: identity lookup ──
  // Read the username before anything is destroyed; the reservation is
  // released in the final batch and there is no other way back to it.
  const username = await readUsername(db, uid);

  // ── Phase 1+2: games and their video objects ──
  // Active games are preserved so an opponent is not stranded mid-match. This
  // matches the pre-existing product decision, not a limitation of admin access.
  const gamesCol = db.collection("games");
  const [asP1, asP2] = await Promise.all([
    scanAll(gamesCol.where("player1Uid", "==", uid)),
    scanAll(gamesCol.where("player2Uid", "==", uid)),
  ]);
  const nonActiveGameIds = new Set<string>();
  for (const snap of [...asP1, ...asP2]) {
    if ((snap.data() as Record<string, unknown>).status !== "active") nonActiveGameIds.add(snap.id);
  }

  // Videos first: once the game doc is gone, nothing records which prefix to
  // clear, so a crash between the two would strand the binaries permanently.
  for (const gameId of nonActiveGameIds) {
    summary.gameVideoObjects += await deletePrefix(deps, `games/${gameId}/`);
  }
  summary.games = await deleteRefs(
    db,
    [...nonActiveGameIds].map((id) => gamesCol.doc(id)),
  );

  // ── Phase 3: authored community content ──
  // Ownership fields mirror the client cascade exactly: clips are keyed by
  // `playerUid`, disputes by `setterUid` (the setter is the only one who can
  // create the doc), and both vote collections by `uid`.
  const [clips, disputes] = await Promise.all([
    scanAll(db.collection("clips").where("playerUid", "==", uid)),
    scanAll(db.collection("disputes").where("setterUid", "==", uid)),
  ]);
  summary.clips = await deleteRefs(
    db,
    clips.map((d) => d.ref),
  );
  summary.disputes = await deleteRefs(
    db,
    disputes.map((d) => d.ref),
  );

  // Clip upvotes carry a denormalized `upvoteCount` on the parent clip that
  // drives the feed's `top` sort, so — exactly like dispute votes below — each
  // vote is removed transactionally with its decrement. Deleting the vote docs
  // alone would permanently inflate the ranking of every clip a deleted account
  // ever upvoted.
  summary.clipVotes = await deleteVotes(db, "clipVotes", "clips", "clipId", () => "upvoteCount", uid);

  // Dispute votes are the same shape, but the field depends on which way the
  // vote went. Guards mirror `deleteUserDisputeVotes`: an unusable target id or
  // verdict still gets the vote deleted (just untargetable for the tally), a
  // parent that is already gone needs no decrement, and a non-positive count is
  // never driven negative.
  summary.disputeVotes = await deleteVotes(
    db,
    "disputeVotes",
    "disputes",
    "disputeId",
    (data) => {
      const verdict = data.verdict;
      if (verdict === "land") return "landVotes";
      if (verdict === "bail") return "bailVotes";
      return null;
    },
    uid,
  );

  // ── Phase 3b: device identifiers and received notifications ──
  // `pushTargets/{uid}` is the cross-readable FCM-token mirror. FCM tokens are
  // device identifiers and therefore personal data, and the mirror is readable
  // by every signed-in user — an orphaned doc would leave a uid→device map
  // exposed after erasure, which is precisely what this cascade exists to close.
  await db.collection("pushTargets").doc(uid).delete();
  summary.pushTargets = 1;
  summary.notifications = await deleteRefs(
    db,
    (await scanAll(db.collection("notifications").where("recipientUid", "==", uid))).map((d) => d.ref),
  );

  // Queued push dispatches embed the recipient's FCM tokens, so an undrained
  // queue would keep device identifiers alive past erasure. The client cascade
  // never covered these — it couldn't, since /push_dispatch is write-only to
  // clients — which is one of the gaps admin credentials close.
  summary.pushDispatch = await deleteRefs(
    db,
    (await scanAll(db.collection("push_dispatch").where("recipientUid", "==", uid))).map((d) => d.ref),
  );

  // Nudges name both parties directly and are classified as the subject's
  // personal data by the GDPR export (`userData.ts`), so both directions go.
  const [nudgesSent, nudgesReceived] = await Promise.all([
    scanAll(db.collection("nudges").where("senderUid", "==", uid)),
    scanAll(db.collection("nudges").where("recipientUid", "==", uid)),
  ]);
  const nudgeRefs = new Map<string, FirebaseFirestore.DocumentReference>();
  for (const d of [...nudgesSent, ...nudgesReceived]) nudgeRefs.set(d.id, d.ref);
  summary.nudges = await deleteRefs(db, [...nudgeRefs.values()]);

  // Reports this user filed. Reports filed *against* them are deliberately
  // kept: those are another user's submission and part of the moderation
  // record, and erasing them on request would make abuse reports removable by
  // the reported party.
  summary.reports = await deleteRefs(
    db,
    (await scanAll(db.collection("reports").where("reporterUid", "==", uid))).map((d) => d.ref),
  );

  // ── Phase 4: identity surface, atomically ──
  // Achievements, the private profile doc (email / DOB / parental consent), the
  // public profile, and the username reservation go in one batch so the whole
  // identity surface survives or vanishes together.
  const achievements = await scanAll(db.collection("users").doc(uid).collection("achievements"));
  // The reservation is released first and separately, because it is the one
  // delete here that needs an ownership check (see `releaseUsername`) and so
  // cannot ride along in an unconditional batch.
  summary.usernameReleased = username !== null && (await releaseUsername(db, uid, username));

  const blocked = await scanAll(db.collection("users").doc(uid).collection("blocked_users"));
  const identityRefs: FirebaseFirestore.DocumentReference[] = [
    ...achievements.map((d) => d.ref),
    ...blocked.map((d) => d.ref),
    db.collection("users").doc(uid).collection("private").doc(PRIVATE_PROFILE_DOC_ID),
    db.collection("users").doc(uid),
  ];
  await deleteRefs(db, identityRefs);
  summary.achievements = achievements.length;
  summary.blockedUsers = blocked.length;

  // ── Phase 5: avatar binaries ──
  // Three extensions because `avatars.ts` may have written any of them.
  for (const ext of AVATAR_EXTENSIONS) {
    summary.avatarObjects += await deletePrefix(deps, `users/${uid}/avatar.${ext}`);
  }

  return summary;
}
