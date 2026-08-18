/**
 * Write-side service for the moderator/admin console.
 *
 * Every function here is gated by the `admin` custom claim on the caller's ID
 * token (see `getAdminClaim` in `auth.ts` for the client-side read and
 * `scripts/set-admin-claim.mjs` for minting it). The claim is the ONLY thing
 * standing between these calls and the collections they touch, so the
 * corresponding `firestore.rules` clauses must require
 * `request.auth.token.admin == true` on every path used below — this module
 * assumes that gate exists and does not attempt to re-implement it client-side.
 * A client-side check is a UI affordance, never an authorization decision.
 *
 * Paths written here
 * ──────────────────
 *   users/{uid}                        isVerifiedPro / verifiedBy / verifiedAt
 *   users/{uid}/achievements/{badgeId}  badge grant (doc id IS the badge key)
 *   users/{uid}/locker/{itemId}         minted gear item
 *   reports/{reportId}                  moderation status transition
 *
 * Payload exactness
 * ─────────────────
 * The rules for these paths pin the exact set of fields a write may carry
 * (see the field guards on `users` update). A drifted payload — an extra key,
 * a renamed one — does not fail loudly at compile time; it fails at runtime as
 * `permission-denied` for the moderator. The payload shapes below are
 * therefore asserted field-by-field in `__tests__/admin.test.ts`.
 *
 * `adminUid` MUST be the CALLER's own uid: the rules pin `verifiedBy` and
 * `resolvedBy` to `request.auth.uid`, so a moderator cannot stamp an audit
 * trail with somebody else's name. Passing another admin's uid is rejected
 * server-side, not silently accepted.
 *
 * Validation posture
 * ──────────────────
 * uids and doc ids are used as Firestore path segments, so an empty string or
 * an embedded "/" would silently retarget the write at a different document.
 * Those inputs throw before any network call rather than resolving — an admin
 * action that quietly no-ops is worse than one that reports failure.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";

/** One row of the moderation queue, read from `reports/{reportId}`. */
export interface AdminReport {
  /** Firestore doc id. */
  id: string;
  /** Author of the report. */
  reporterUid: string;
  /** Subject of the report. */
  reportedUid: string;
  /** Denormalized username of the subject, as captured at report time. */
  reportedUsername: string;
  /** Game the report was filed from. */
  gameId: string;
  /** A `ReportReason` value in practice; read as a plain string — see note. */
  reason: string;
  /**
   * The reporter's own account of what happened, capped at 500 chars by the
   * create rule. UNTRUSTED user-authored text: render as plain text only.
   * Empty string when the reporter left it blank or the field is malformed.
   */
  description: string;
  /**
   * Deterministic clip id (`${gameId}_${turnNumber}_${role}`) when the report
   * targets a single feed clip rather than the game as a whole. `null` when
   * absent, blank or malformed — the field is optional in the create rule.
   */
  clipId: string | null;
  /** "pending" | "resolved" | "dismissed" in practice; read as a string. */
  status: string;
  /** Filing time, or `null` when the field is missing or not a Timestamp. */
  createdAt: Date | null;
  /**
   * Admin uid stamped by {@link resolveReport}. Empty string while the report
   * is still pending (or on a doc resolved before the field was written).
   */
  resolvedBy: string;
  /** Resolution time, or `null` when unresolved / not a Timestamp. */
  resolvedAt: Date | null;
}

/** Fields the console supplies when minting a locker item. */
export interface AdminLockerItemInput {
  /** Catalogue category ("deck", "wheels", …). Free-form: see `locker.ts`. */
  type: string;
  /** Brand name. May be empty — the read mapper renders "" fine. */
  brand: string;
  /** Display name. Required: a nameless item is a blank tile in the locker. */
  name: string;
  /** Artwork URL, or `null` when the item has none. Blank collapses to null. */
  imageUrl: string | null;
  /** Rarity tier ("common", "uncommon", "rare", "limited"). */
  rarity: string;
  /** Audit trail — why this item was granted. Stored as `provenance.reason`. */
  provenanceReason: string;
}

/**
 * Minimal structural view of a query doc snapshot — mirrors the note in
 * `achievements.ts`: structural rather than `QueryDocumentSnapshot` so the
 * parser stays trivially unit-testable across the vitest module-mock boundary.
 */
interface ParsableDoc {
  id: string;
  data: () => unknown;
}

/** Sort key for reports with no `createdAt` — pushes them last in a
 *  descending sort. `Array#sort` is stable, so ties keep Firestore order. */
const UNDATED_SORT_KEY = Number.MIN_SAFE_INTEGER;

/** Statuses `resolveReport` is allowed to write. Mirrors the rules' allowlist. */
const RESOLVABLE_STATUSES = new Set<string>(["resolved", "dismissed"]);

/**
 * Field-length caps mirrored from the admin create clauses in
 * `firestore.rules` (`reason.size() <= 200`, item strings `<= 100`). Checked
 * here so an over-long field fails with a legible message instead of an opaque
 * `permission-denied` after the round-trip. The rule remains authoritative;
 * this is a fail-fast, not the enforcement point.
 */
const MAX_REASON_LEN = 200;
const MAX_ITEM_FIELD_LEN = 100;

/** See `achievements.ts` — structural Timestamp detection, `null` otherwise. */
function toDateOrNull(value: unknown): Date | null {
  if (!value || typeof value !== "object") return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return null;
  const date: unknown = toDate.call(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date;
}

/** Tolerant string read for server-authored docs: anything else becomes "". */
function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Tolerant read for an OPTIONAL string field. A blank value collapses to
 * `null` rather than `""` so the UI branches on presence instead of having to
 * re-test for emptiness — same convention as `locker.ts` → `imageUrl`.
 */
function toStringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/**
 * A uid / doc id is only ever used as a Firestore path segment here. Empty
 * strings and segment separators would build a path pointing somewhere else
 * entirely. The `typeof` check guards JS callers TypeScript can't police.
 * Same guard as `achievements.ts` → `isValidUid`.
 */
function isValidUid(uid: string): boolean {
  return typeof uid === "string" && uid.length > 0 && !uid.includes("/");
}

/** Throw before any network call on an unusable path segment. */
function requireId(value: string, label: string): void {
  if (!isValidUid(value)) throw new Error(`Invalid ${label}.`);
}

/** Throw on a required free-text field that is missing, blank or over-long. */
function requireText(value: string, label: string, maxLen: number): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Invalid ${label}.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLen) {
    throw new Error(`Too long — ${label} must be ${maxLen} characters or fewer.`);
  }
  return trimmed;
}

/**
 * Flip the verified-pro flag on a profile inside a transaction.
 *
 * A transaction (rather than a bare `updateDoc`) because the pre-read is the
 * only thing that distinguishes "granted pro to the right skater" from
 * "created a stray field on a mistyped uid" — `update` on a missing doc fails
 * with an opaque `not-found`, and two moderators acting at once would
 * otherwise interleave the audit stamp with the flag.
 *
 * Writes EXACTLY `{ isVerifiedPro, verifiedBy, verifiedAt }`. Revocation
 * re-stamps `verifiedBy`/`verifiedAt` with the revoking admin: taking pro
 * status away is an audited admin act, not an erasure of the audit trail.
 */
async function setVerifiedPro(adminUid: string, targetUid: string, isVerifiedPro: boolean): Promise<void> {
  requireId(adminUid, "admin uid");
  requireId(targetUid, "target uid");

  const db = requireDb();
  const userRef = doc(db, "users", targetUid);

  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error("That skater's profile no longer exists.");
      tx.update(userRef, {
        isVerifiedPro,
        verifiedBy: adminUid,
        verifiedAt: serverTimestamp(),
      });
    });
  } catch (err) {
    logger.warn("admin_verified_pro_write_failed", {
      adminUid,
      targetUid,
      isVerifiedPro,
      error: parseFirebaseError(err),
    });
    throw err;
  }
}

/** Grant verified-pro status to `targetUid`, stamped with the acting admin. */
export async function grantVerifiedPro(adminUid: string, targetUid: string): Promise<void> {
  return setVerifiedPro(adminUid, targetUid, true);
}

/** Revoke verified-pro status from `targetUid`, stamped with the acting admin. */
export async function revokeVerifiedPro(adminUid: string, targetUid: string): Promise<void> {
  return setVerifiedPro(adminUid, targetUid, false);
}

/**
 * Grant a badge. The doc id IS the badge key, so `setDoc` at a known id is
 * deliberate, not a stand-in for `addDoc`: one badge per key, per user.
 *
 * Payload: `{ earnedAt: serverTimestamp(), reason }` — exactly the shape
 * `fetchAchievements` reads back, and exactly the key set the rules pin.
 *
 * Re-awarding a badge the skater already holds is REJECTED (the achievements
 * rule is `allow update: if false`, which keeps `earnedAt` honest). Revoke
 * first, then re-award.
 */
export async function awardAchievement(targetUid: string, badgeId: string, reason: string): Promise<void> {
  requireId(targetUid, "target uid");
  requireId(badgeId, "badge id");
  const trimmedReason = requireText(reason, "reason", MAX_REASON_LEN);

  try {
    await setDoc(doc(requireDb(), "users", targetUid, "achievements", badgeId), {
      earnedAt: serverTimestamp(),
      reason: trimmedReason,
    });
  } catch (err) {
    logger.warn("admin_achievement_award_failed", { targetUid, badgeId, error: parseFirebaseError(err) });
    throw err;
  }
}

/** Remove a badge. Idempotent — deleting a missing doc is not an error. */
export async function revokeAchievement(targetUid: string, badgeId: string): Promise<void> {
  requireId(targetUid, "target uid");
  requireId(badgeId, "badge id");

  try {
    await deleteDoc(doc(requireDb(), "users", targetUid, "achievements", badgeId));
  } catch (err) {
    logger.warn("admin_achievement_revoke_failed", { targetUid, badgeId, error: parseFirebaseError(err) });
    throw err;
  }
}

/**
 * Mint a locker item and return its new doc id.
 *
 * `addDoc` (auto-id) because items are not unique per user — a skater can own
 * two of the same deck. `provenance` is written as a nested map, matching both
 * the rules' field guard and `fetchLockerItems`' `provenance.reason` read.
 *
 * All seven keys are always written, `imageUrl` included: the locker create
 * rule reads every one of them, so omitting a key fails closed. A blank
 * `imageUrl` is therefore stored as an explicit `null`, never `""` or absent —
 * an empty `src` also makes browsers re-request the current page instead of
 * rendering the fallback tile.
 */
export async function awardLockerItem(targetUid: string, item: AdminLockerItemInput): Promise<string> {
  requireId(targetUid, "target uid");
  const type = requireText(item.type, "item type", MAX_ITEM_FIELD_LEN);
  const name = requireText(item.name, "item name", MAX_ITEM_FIELD_LEN);
  const rarity = requireText(item.rarity, "item rarity", MAX_ITEM_FIELD_LEN);
  const provenanceReason = requireText(item.provenanceReason, "provenance reason", MAX_REASON_LEN);
  const brand = typeof item.brand === "string" ? item.brand.trim() : "";
  if (brand.length > MAX_ITEM_FIELD_LEN) {
    throw new Error(`Too long — item brand must be ${MAX_ITEM_FIELD_LEN} characters or fewer.`);
  }
  const imageUrl = typeof item.imageUrl === "string" && item.imageUrl.trim().length > 0 ? item.imageUrl.trim() : null;

  try {
    const ref = await addDoc(collection(requireDb(), "users", targetUid, "locker"), {
      type,
      brand,
      name,
      imageUrl,
      rarity,
      acquiredAt: serverTimestamp(),
      provenance: { reason: provenanceReason },
    });
    return ref.id;
  } catch (err) {
    logger.warn("admin_locker_award_failed", { targetUid, type, error: parseFirebaseError(err) });
    throw err;
  }
}

/** Remove a locker item. Idempotent — deleting a missing doc is not an error. */
export async function removeLockerItem(targetUid: string, itemId: string): Promise<void> {
  requireId(targetUid, "target uid");
  requireId(itemId, "item id");

  try {
    await deleteDoc(doc(requireDb(), "users", targetUid, "locker", itemId));
  } catch (err) {
    logger.warn("admin_locker_remove_failed", { targetUid, itemId, error: parseFirebaseError(err) });
    throw err;
  }
}

/** Parse one report doc. Returns `null` for a doc the queue can't render. */
function toAdminReport(snap: ParsableDoc): AdminReport | null {
  const raw: unknown = snap.data();
  if (!raw || typeof raw !== "object") return null;
  if (typeof snap.id !== "string" || snap.id.length === 0) return null;

  const data = raw as Record<string, unknown>;
  return {
    id: snap.id,
    reporterUid: toStringOrEmpty(data.reporterUid),
    reportedUid: toStringOrEmpty(data.reportedUid),
    reportedUsername: toStringOrEmpty(data.reportedUsername),
    gameId: toStringOrEmpty(data.gameId),
    // Neither `reason` nor `status` is narrowed to a union: both are written by
    // clients and future servers, and an unrecognised value must still appear
    // in the queue — dropping it would hide the report from moderation.
    reason: toStringOrEmpty(data.reason),
    // The evidence half of the report. Both are carried verbatim — the queue
    // exists to show a moderator what was actually written and which clip was
    // flagged; sanitising or truncating here would hide the thing being judged.
    // Rendering safety is the UI's job (plain text, never innerHTML).
    description: toStringOrEmpty(data.description),
    clipId: toStringOrNull(data.clipId),
    status: toStringOrEmpty(data.status),
    createdAt: toDateOrNull(data.createdAt),
    // The resolution audit pair. Written by `resolveReport`; absent on every
    // pending report, so both degrade to the empty/null sentinels rather than
    // failing the parse.
    resolvedBy: toStringOrEmpty(data.resolvedBy),
    resolvedAt: toDateOrNull(data.resolvedAt),
  };
}

/**
 * Read the moderation queue, newest first.
 *
 * `statusFilter` narrows server-side via `where("status", "==", …)`; omitted
 * (or blank) returns every report. Ordering is done in memory rather than with
 * a Firestore `orderBy("createdAt")` for the same reason as `achievements.ts`:
 * a server-side orderBy silently drops docs missing the sort field, and a
 * report that fails to appear in the queue is a report nobody actions.
 *
 * Malformed docs are logged and skipped — one corrupt record never blanks the
 * queue. Transport failures DO reject so the console can offer a retry.
 */
export async function fetchReports(statusFilter?: string): Promise<AdminReport[]> {
  const reportsRef = collection(requireDb(), "reports");
  const source =
    typeof statusFilter === "string" && statusFilter.length > 0
      ? query(reportsRef, where("status", "==", statusFilter))
      : reportsRef;

  const snap = await withRetry(() => getDocs(source));

  const reports: AdminReport[] = [];
  for (const docSnap of snap.docs) {
    try {
      const parsed = toAdminReport(docSnap);
      if (parsed) {
        reports.push(parsed);
      } else {
        logger.warn("malformed_report_doc", { docId: docSnap.id });
      }
    } catch (err) {
      logger.warn("report_doc_parse_failed", { docId: docSnap.id, error: parseFirebaseError(err) });
    }
  }

  return reports.sort(
    (a, b) => (b.createdAt?.getTime() ?? UNDATED_SORT_KEY) - (a.createdAt?.getTime() ?? UNDATED_SORT_KEY),
  );
}

/**
 * Close out a report.
 *
 * Writes EXACTLY `{ status, resolvedBy, resolvedAt }`. The status allowlist is
 * enforced at runtime as well as in the type: a JS caller (or a drifted UI
 * constant) passing anything else would write a status the queue filter can
 * never surface again, stranding the report.
 */
export async function resolveReport(
  adminUid: string,
  reportId: string,
  status: "resolved" | "dismissed",
): Promise<void> {
  requireId(adminUid, "admin uid");
  requireId(reportId, "report id");
  if (!RESOLVABLE_STATUSES.has(status)) throw new Error("Invalid report status.");

  try {
    await updateDoc(doc(requireDb(), "reports", reportId), {
      status,
      resolvedBy: adminUid,
      resolvedAt: serverTimestamp(),
    });
  } catch (err) {
    logger.warn("admin_report_resolve_failed", { adminUid, reportId, status, error: parseFirebaseError(err) });
    throw err;
  }
}
