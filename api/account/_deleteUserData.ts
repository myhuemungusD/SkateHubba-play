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
 *   • Complete, and checked. Every collection in firestore.rules is listed in
 *     `_userDataRegistry.ts` as deleted, anonymized, retained (with the reason)
 *     or not personal. A test fails when a new collection is not listed.
 *   • Other people's history is kept. Records two people share (dice matches,
 *     closet trades, serial ownership, public spots) are anonymized rather than
 *     deleted, so the other skater does not lose their side. Records other
 *     people filed about this user (reports, disputes they raised) stay.
 */

import type { Firestore } from "firebase-admin/firestore";
import { deleteIfPresent, deletePrefix, deleteRefs, scanAll, type CascadeDeps } from "./_cascadeUtil.js";
import { emptyClosetCounts, eraseCloset, type ClosetErasureCounts } from "./_closetErasure.js";
import { anonymizeJudgedGames, eraseActiveSkateGames } from "./_skateErasure.js";
import { eraseDiceGames } from "./_diceErasure.js";
import { emptyOwnedCounts, eraseOwnedContent, type OwnedContentCounts } from "./_ownedContent.js";

export type { CascadeDeps } from "./_cascadeUtil.js";

/** Owner-only canonical doc under `users/{uid}/private` — mirrors users.ts. */
const PRIVATE_PROFILE_DOC_ID = "profile";

/** Avatar extensions written by `src/services/avatars.ts`. */
const AVATAR_EXTENSIONS = ["webp", "jpeg", "png"] as const;

/**
 * Every subcollection under users/{uid} besides the ones counted on their own
 * (achievements, locker, xpMarkers, blocked_users). Firestore does not delete
 * subcollections with their parent, so each is named here. The coverage test
 * (`account-delete.coverage.test.ts`) fails when firestore.rules gains a
 * users/{uid} subcollection that is not listed in `_userDataRegistry.ts`.
 */
export const OTHER_USER_SUBCOLLECTIONS = [
  "private",
  "wallet",
  "ledger",
  "closetLimits",
  "closetDesigns",
  "profileCustom",
  "passport",
  "checkins",
] as const;

/** Per-collection counts, returned to the caller for logging and the response body. */
export interface DeletionSummary {
  games: number;
  gameVideoObjects: number;
  /** Active S.K.A.T.E. games closed (forfeit to the opponent) and anonymized. */
  skateGamesForfeited: number;
  /** S.K.A.T.E. games kept for the opponent with this account replaced by the tombstone. */
  skateGamesAnonymized: number;
  /** Games this account judged, with the judge replaced by the tombstone. */
  skateGamesJudgedAnonymized: number;
  clips: number;
  clipVotes: number;
  disputes: number;
  disputeVotes: number;
  notifications: number;
  pushTargets: number;
  pushDispatch: number;
  nudges: number;
  reports: number;
  /** Statements of reasons written about this user. */
  moderationStatements: number;
  /** Appeals this user filed. */
  appeals: number;
  achievements: number;
  locker: number;
  /** Opponent and spot markers under users/{uid}/xpMarkers. */
  xpMarkers: number;
  blockedUsers: number;
  avatarObjects: number;
  usernameReleased: boolean;
  /** Active Roll Dice matches closed so the other player is not left waiting. */
  diceGames: number;
  /** 1 when diceStats/{uid} existed and was deleted, otherwise 0. */
  diceStats: number;
  /** 1 when diceCreateLimits/{uid} existed and was deleted, otherwise 0. */
  diceCreateLimits: number;
  /** Training-label rows whose clip this user filmed. */
  trainingLabels: number;
  /** 1 when a pending training-consent revocation doc was deleted, otherwise 0. */
  trainingRevocations: number;
  /** Finished or just-closed dice matches kept for the other player, with this account anonymized. */
  diceGamesAnonymized: number;
  /** Dice matches deleted because both players are gone. */
  diceGamesDeleted: number;
  /** Docs in {@link OTHER_USER_SUBCOLLECTIONS} (private profile, Closet wallet and ledger, designs...). */
  userSubcollectionDocs: number;
  /** Trades, serial ownership and drop entries. */
  closet: ClosetErasureCounts;
  /** Spot chat, comments, spots, live map state, pro posts, rate limits and media. */
  content: OwnedContentCounts;
}

function emptySummary(): DeletionSummary {
  return {
    games: 0,
    gameVideoObjects: 0,
    skateGamesForfeited: 0,
    skateGamesAnonymized: 0,
    skateGamesJudgedAnonymized: 0,
    clips: 0,
    clipVotes: 0,
    disputes: 0,
    disputeVotes: 0,
    notifications: 0,
    pushTargets: 0,
    pushDispatch: 0,
    nudges: 0,
    reports: 0,
    moderationStatements: 0,
    appeals: 0,
    achievements: 0,
    locker: 0,
    xpMarkers: 0,
    blockedUsers: 0,
    avatarObjects: 0,
    usernameReleased: false,
    diceGames: 0,
    diceStats: 0,
    diceCreateLimits: 0,
    trainingLabels: 0,
    trainingRevocations: 0,
    diceGamesAnonymized: 0,
    diceGamesDeleted: 0,
    userSubcollectionDocs: 0,
    closet: emptyClosetCounts(),
    content: emptyOwnedCounts(),
  };
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
  // Finished games are deleted with their videos. Active games are closed as
  // a forfeit to the opponent and anonymized (see `_skateErasure.ts`), so the
  // opponent is not stranded and no uid, username or video of this account
  // stays behind in them.
  const gamesCol = db.collection("games");
  const [asP1, asP2] = await Promise.all([
    scanAll(gamesCol.where("player1Uid", "==", uid)),
    scanAll(gamesCol.where("player2Uid", "==", uid)),
  ]);
  const nonActiveGameIds = new Set<string>();
  const activeGameIds = new Set<string>();
  for (const snap of [...asP1, ...asP2]) {
    if ((snap.data() as Record<string, unknown>).status !== "active") nonActiveGameIds.add(snap.id);
    else activeGameIds.add(snap.id);
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
  const skate = await eraseActiveSkateGames(deps, uid, [...activeGameIds], Date.now());
  summary.skateGamesForfeited = skate.forfeited;
  summary.skateGamesAnonymized = skate.anonymized;
  summary.games += skate.deleted;
  summary.gameVideoObjects += skate.videoObjects;
  summary.skateGamesJudgedAnonymized = await anonymizeJudgedGames(db, uid);

  // ── Phase 2b: Roll Dice ──
  // Unlike S.K.A.T.E., an open dice match is closed rather than left active.
  // The other player would otherwise sit on a turn that can never be taken.
  // A match nobody has rolled in just ends. A match that has started is a
  // forfeit: the player who stays gets the win. Every match is then
  // anonymized for the other player (see `_diceErasure.ts`). The departing
  // user's own diceStats doc is deleted below, so their loss is not written.
  const nowMs = Date.now();
  const dice = await eraseDiceGames(db, uid, nowMs);
  summary.diceGames = dice.closed;
  summary.diceGamesAnonymized = dice.anonymized;
  summary.diceGamesDeleted = dice.deleted;
  summary.diceStats = await deleteIfPresent(db, "diceStats", uid);
  summary.diceCreateLimits = await deleteIfPresent(db, "diceCreateLimits", uid);

  const trainingLabels = await scanAll(db.collection("trainingLabels").where("ownerUid", "==", uid));
  summary.trainingLabels = await deleteRefs(
    db,
    trainingLabels.map((label) => label.ref),
  );
  summary.trainingRevocations = await deleteIfPresent(db, "trainingRevocations", uid);

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
  // Deleted blind rather than read-then-deleted: a doc that isn't there is a
  // no-op, and one saved read per deletion is worth more than an exact count.
  // The summary field therefore reports "attempted", not "found" — it reaches
  // the response body, so don't read it as evidence a mirror existed.
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

  // Statements name the subject; appeals name the appellant. Both are that
  // person's data. Reports filed against them stay (see above).
  summary.moderationStatements = await deleteRefs(
    db,
    (await scanAll(db.collection("moderationStatements").where("subjectUid", "==", uid))).map((d) => d.ref),
  );
  summary.appeals = await deleteRefs(
    db,
    (await scanAll(db.collection("appeals").where("appellantUid", "==", uid))).map((d) => d.ref),
  );

  // ── Phase 3c: Closet trades and drops, spot chat, comments, spots ──
  // Shared records (trades, serial rows, public spots) are anonymized, the
  // rest is deleted. Rationale per collection lives in each module and in
  // `_userDataRegistry.ts`. Runs before Phase 4 because a held trade's
  // refund reads the other skater's wallet, and both modules locate data by
  // uid fields that stay valid until the identity docs go.
  summary.closet = await eraseCloset(db, uid, nowMs);
  summary.content = await eraseOwnedContent(deps, uid);

  // ── Phase 4: identity surface ──
  // Achievements, locker, blocked_users, the private profile doc (email / DOB /
  // parental consent) and the public profile go together, so in the ordinary
  // case the whole identity surface vanishes in a single commit. Past
  // BATCH_CHUNK refs it necessarily splits across commits — harmless, because
  // this phase runs last and the run is resumable, but it is not the atomic
  // guarantee the single-batch shape suggests.
  //
  // Locker mirrors achievements exactly: both are Admin-SDK-minted economy
  // subcollections under users/{uid}, and both are swept by the client cascade
  // in `src/services/users.ts`. A subcollection is NOT deleted by deleting its
  // parent document in Firestore, so each one has to be enumerated by name —
  // any future subcollection added under users/{uid} must be added here too.
  const achievements = await scanAll(db.collection("users").doc(uid).collection("achievements"));
  const locker = await scanAll(db.collection("users").doc(uid).collection("locker"));
  const xpMarkers = await scanAll(db.collection("users").doc(uid).collection("xpMarkers"));
  // The reservation is released first and separately, because it is the one
  // delete here that needs an ownership check (see `releaseUsername`) and so
  // cannot ride along in an unconditional batch.
  summary.usernameReleased = username !== null && (await releaseUsername(db, uid, username));

  const blocked = await scanAll(db.collection("users").doc(uid).collection("blocked_users"));
  const others: FirebaseFirestore.DocumentReference[] = [];
  for (const name of OTHER_USER_SUBCOLLECTIONS) {
    for (const d of await scanAll(db.collection("users").doc(uid).collection(name))) others.push(d.ref);
  }
  const profileRef = db.collection("users").doc(uid).collection("private").doc(PRIVATE_PROFILE_DOC_ID);
  const identityRefs: FirebaseFirestore.DocumentReference[] = [
    ...achievements.map((d) => d.ref),
    ...locker.map((d) => d.ref),
    ...xpMarkers.map((d) => d.ref),
    ...blocked.map((d) => d.ref),
    // The private profile keeps its explicit ref (as before this list
    // existed); it is filtered out of `others` so one batch never deletes
    // the same doc twice.
    ...others.filter((ref) => ref.path !== profileRef.path),
    profileRef,
    db.collection("users").doc(uid),
  ];
  await deleteRefs(db, identityRefs);
  summary.userSubcollectionDocs = others.length;
  summary.achievements = achievements.length;
  summary.locker = locker.length;
  summary.xpMarkers = xpMarkers.length;
  summary.blockedUsers = blocked.length;

  // ── Phase 5: avatar binaries ──
  // Three extensions because `avatars.ts` may have written any of them.
  for (const ext of AVATAR_EXTENSIONS) {
    summary.avatarObjects += await deletePrefix(deps, `users/${uid}/avatar.${ext}`);
  }

  return summary;
}
