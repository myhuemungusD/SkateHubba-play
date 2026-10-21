/**
 * Erasure of content this account wrote that lives outside users/{uid} and
 * was not covered before: spot chat, comments, spots, live map state, pro
 * community posts, rate-limit anchors and uploaded media.
 *
 * Deleted outright (it is this person's own words, location or media):
 *   • spot chat messages (spots/{id}/messages) and comments on spots and clips
 *     (collection-group queries on `userId`; need the COLLECTION_GROUP field
 *     overrides in firestore.indexes.json)
 *   • live presence (spotPresence/{id}/here/{uid}, collection group on `uid`),
 *     mapState, passportSettings, onlineStatus, skaterActivity
 *   • private and crew-only spots they created
 *   • spot-message reports, WTT votes, pro reviews, pro challenge entries,
 *     pro challenges/props/featured posts they authored, props sent to them
 *   • notification / push / nudge / report rate-limit anchors they own
 *   • Storage: closet design art, private and approved clip videos, banner
 *
 * Anonymized (shared with the community):
 *   • public spots they added keep existing, because other skaters' check-ins,
 *     passport stamps, comments, chat and games point at them. Only
 *     `createdBy` is rewritten to the tombstone.
 *   • crew lists on other people's private spots drop this uid.
 */
import type { Firestore } from "firebase-admin/firestore";
import { DELETED_UID } from "./_anonymize.js";
import { commitWrites, deletePrefix, deleteRefs, deleteWhere, scanAll, type CascadeDeps } from "./_cascadeUtil.js";

export interface OwnedContentCounts {
  spotMessages: number;
  comments: number;
  spotPresence: number;
  /** Per-uid map and presence docs (mapState, passportSettings, onlineStatus, skaterActivity) attempted. */
  mapDocs: number;
  privateSpots: number;
  /** Public spots kept with `createdBy` anonymized. */
  spotsAnonymized: number;
  /** Other people's crew spots this uid was removed from. */
  crewListsUpdated: number;
  spotMessageReports: number;
  wttVotes: number;
  proContent: number;
  rateLimits: number;
  mediaObjects: number;
}

/** Docs keyed by the uid itself. Deleted blind: a missing doc is a no-op. */
const UID_KEYED = ["mapState", "passportSettings", "onlineStatus", "skaterActivity"] as const;

/** [collection, owner field] pairs deleted by an equality scan. */
const OWNED_BY_FIELD: readonly (readonly [string, string, keyof OwnedContentCounts])[] = [
  ["privateSpots", "createdBy", "privateSpots"],
  ["spotMessageReports", "reportedBy", "spotMessageReports"],
  ["wttVotes", "uid", "wttVotes"],
  ["proReviews", "uid", "proContent"],
  ["proChallengeEntries", "uid", "proContent"],
  ["proChallenges", "proUid", "proContent"],
  ["proFeatured", "proUid", "proContent"],
  ["proProps", "fromUid", "proContent"],
  ["proProps", "toUid", "proContent"],
  ["notification_limits", "senderUid", "rateLimits"],
  ["push_dispatch_limits", "senderUid", "rateLimits"],
  ["nudge_limits", "senderUid", "rateLimits"],
  ["reports_limits", "reporterUid", "rateLimits"],
];

/** Storage prefixes this account owns outright (avatars and game videos are handled by the orchestrator). */
export function ownedMediaPrefixes(uid: string): string[] {
  return [`closetDesigns/${uid}/`, `userClips/${uid}/`, `approvedClips/${uid}/`, `users/${uid}/banner.`];
}

async function deleteGroupWhere(db: Firestore, group: string, field: string, uid: string): Promise<number> {
  const hits = await scanAll(db.collectionGroup(group).where(field, "==", uid));
  return deleteRefs(
    db,
    hits.map((d) => d.ref),
  );
}

export function emptyOwnedCounts(): OwnedContentCounts {
  return {
    spotMessages: 0,
    comments: 0,
    spotPresence: 0,
    mapDocs: 0,
    privateSpots: 0,
    spotsAnonymized: 0,
    crewListsUpdated: 0,
    spotMessageReports: 0,
    wttVotes: 0,
    proContent: 0,
    rateLimits: 0,
    mediaObjects: 0,
  };
}

export async function eraseOwnedContent(deps: CascadeDeps, uid: string): Promise<OwnedContentCounts> {
  const { db } = deps;
  const counts = emptyOwnedCounts();

  // Media first, for the same reason the orchestrator clears game videos
  // before game docs: a crash must not strand binaries nothing points at.
  for (const prefix of ownedMediaPrefixes(uid)) counts.mediaObjects += await deletePrefix(deps, prefix);

  counts.spotMessages = await deleteGroupWhere(db, "messages", "userId", uid);
  counts.comments = await deleteGroupWhere(db, "comments", "userId", uid);
  counts.spotPresence = await deleteGroupWhere(db, "here", "uid", uid);

  await deleteRefs(
    db,
    UID_KEYED.map((name) => db.collection(name).doc(uid)),
  );
  counts.mapDocs = UID_KEYED.length;

  for (const [name, field, bucket] of OWNED_BY_FIELD) counts[bucket] += await deleteWhere(db, name, field, uid);

  const spots = await scanAll(db.collection("spots").where("createdBy", "==", uid));
  counts.spotsAnonymized = await commitWrites(
    db,
    spots.map((s) => ({ ref: s.ref, kind: "update" as const, data: { createdBy: DELETED_UID } })),
  );

  const crews = await scanAll(db.collection("privateSpots").where("crewUids", "array-contains", uid));
  counts.crewListsUpdated = await commitWrites(
    db,
    crews.map((s) => {
      const list = (s.data() as Record<string, unknown>).crewUids;
      const crewUids = Array.isArray(list) ? list.filter((id) => id !== uid) : [];
      return { ref: s.ref, kind: "update" as const, data: { crewUids } };
    }),
  );
  return counts;
}
