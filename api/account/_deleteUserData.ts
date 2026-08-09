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
  achievements: number;
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
    achievements: 0,
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
 * Read the account's username so the reservation in `/usernames` can be
 * released. Derived from the profile document rather than accepted from the
 * request body: the caller must never be able to name which reservation to
 * free, or one account could release another's username.
 *
 * Returns null when the profile is already gone (a resumed run), in which case
 * the reservation was either freed on the previous attempt or was never held.
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
 * Delete every object under a Storage prefix.
 *
 * `deleteFiles` paginates internally. A missing prefix is not an error — it
 * resolves with nothing deleted, which is exactly the resumed-run case.
 */
async function deletePrefix(deps: CascadeDeps, prefix: string): Promise<number> {
  const bucket = deps.storage.bucket(deps.bucketName);
  const [files] = await bucket.getFiles({ prefix });
  await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true })));
  return files.length;
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

  summary.clipVotes = await deleteRefs(
    db,
    (await scanAll(db.collection("clipVotes").where("uid", "==", uid))).map((d) => d.ref),
  );

  // Dispute votes carry a tally on the parent dispute, so each one is removed
  // transactionally with its decrement — deleting the vote alone would leave
  // the dispute advertising a verdict count that no longer has votes behind it.
  // Guards mirror `deleteUserDisputeVotes`: an unusable disputeId/verdict still
  // gets the vote deleted (just untargetable for the tally), a dispute that is
  // already gone needs no decrement, and a non-positive count is never driven
  // negative.
  for (const voteDoc of await scanAll(db.collection("disputeVotes").where("uid", "==", uid))) {
    const data = voteDoc.data() as { disputeId?: unknown; verdict?: unknown };
    const disputeId = typeof data.disputeId === "string" && data.disputeId.length > 0 ? data.disputeId : null;
    const verdict = data.verdict === "land" || data.verdict === "bail" ? data.verdict : null;
    await db.runTransaction(async (tx) => {
      if (disputeId === null || verdict === null) {
        tx.delete(voteDoc.ref);
        return;
      }
      const disputeRef = db.collection("disputes").doc(disputeId);
      const disputeSnap = await tx.get(disputeRef);
      tx.delete(voteDoc.ref);
      if (!disputeSnap.exists) return;
      const field = verdict === "land" ? "landVotes" : "bailVotes";
      const current = (disputeSnap.data() as Record<string, unknown>)[field];
      const count = typeof current === "number" && Number.isFinite(current) ? current : 0;
      if (count <= 0) return;
      tx.update(disputeRef, { [field]: count - 1 });
    });
    summary.disputeVotes += 1;
  }

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

  // ── Phase 4: identity surface, atomically ──
  // Achievements, the private profile doc (email / DOB / parental consent), the
  // public profile, and the username reservation go in one batch so the whole
  // identity surface survives or vanishes together.
  const achievements = await scanAll(db.collection("users").doc(uid).collection("achievements"));
  const identityRefs: FirebaseFirestore.DocumentReference[] = [
    ...achievements.map((d) => d.ref),
    db.collection("users").doc(uid).collection("private").doc(PRIVATE_PROFILE_DOC_ID),
    db.collection("users").doc(uid),
  ];
  if (username) identityRefs.push(db.collection("usernames").doc(username));
  await deleteRefs(db, identityRefs);
  summary.achievements = achievements.length;
  summary.usernameReleased = username !== null;

  // ── Phase 5: avatar binaries ──
  // Three extensions because `avatars.ts` may have written any of them.
  for (const ext of AVATAR_EXTENSIONS) {
    summary.avatarObjects += await deletePrefix(deps, `users/${uid}/avatar.${ext}`);
  }

  return summary;
}
