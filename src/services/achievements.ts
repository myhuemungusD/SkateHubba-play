/**
 * Read-side service for the Economy Phase A achievements surface.
 *
 * Data model
 * ──────────
 *   users/{uid}/achievements/{badgeKey}
 *     earnedAt: Timestamp — when the grant landed
 *     reason:   string    — short human-readable explanation of the grant
 *
 * The doc id IS the badge key ("century", "club150", "og", "streak10",
 * "pioneer", …) — the UI maps it to a label/icon, this service does not.
 *
 * Grants are Admin-SDK-only (`firestore.rules` → users/{uid}/achievements
 * denies client create/update outright), so this module is read-only by
 * design: a client that can mint a badge has no reputation system.
 *
 * Forward compatibility
 * ─────────────────────
 * Because the docs are server-authored, their shape can gain fields ahead of
 * the client shipping support for them. Parsing is therefore deliberately
 * tolerant: unknown fields are ignored, a field of the wrong type degrades to
 * `null` rather than throwing, and a doc that cannot be parsed at all is
 * skipped so one bad record never blanks the whole ribbon.
 *
 * Ordering
 * ────────
 * Sorting happens in memory, NOT via a Firestore `orderBy("earnedAt")`. A
 * server-side orderBy silently drops every doc missing the sort field, which
 * would hide legitimately granted badges written by an older (or newer)
 * server. Badge counts per user are bounded (tens), so client-side sorting is
 * free.
 */

import { collection, getDocs } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";

/** One earned badge on `users/{uid}/achievements`. */
export interface Achievement {
  /** Firestore doc id — the badge key, e.g. "century" or "streak10". */
  id: string;
  /** Grant time, or `null` when the field is missing or not a Timestamp. */
  earnedAt: Date | null;
  /** Server-written grant explanation, or `null` when absent/malformed. */
  reason: string | null;
}

/**
 * Minimal structural view of a query doc snapshot. Structural rather than
 * `QueryDocumentSnapshot` so the parser stays trivially unit-testable and
 * doesn't depend on SDK class identity across the vitest mock boundary
 * (same approach as `spots.ts`).
 */
interface ParsableDoc {
  id: string;
  data: () => unknown;
}

/**
 * Sort key used for docs with no `earnedAt`. Pushes them to the end of a
 * descending sort; ties keep their Firestore order because `Array#sort` is
 * stable (ES2019+).
 */
const UNDATED_SORT_KEY = Number.MIN_SAFE_INTEGER;

/**
 * Convert a Firestore Timestamp-shaped field into a `Date`. Uses structural
 * duck-typing on `.toDate()` rather than `instanceof Timestamp` — the latter
 * is brittle across multiple SDK instances and across the test module mock.
 * Anything that isn't a resolvable Timestamp becomes `null`.
 */
function toDateOrNull(value: unknown): Date | null {
  if (!value || typeof value !== "object") return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return null;
  const date: unknown = toDate.call(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date;
}

/**
 * A uid is only used as a Firestore path segment here. Empty strings and
 * segment separators would build a path pointing somewhere else entirely, so
 * they short-circuit before the read. The `typeof` check guards JS callers
 * that TypeScript can't police.
 */
function isValidUid(uid: string): boolean {
  return typeof uid === "string" && uid.length > 0 && !uid.includes("/");
}

/** Parse one achievement doc. Returns `null` for a doc we can't render. */
function toAchievement(snap: ParsableDoc): Achievement | null {
  const raw: unknown = snap.data();
  if (!raw || typeof raw !== "object") return null;
  if (typeof snap.id !== "string" || snap.id.length === 0) return null;

  const data = raw as Record<string, unknown>;
  const reason = data.reason;
  return {
    id: snap.id,
    earnedAt: toDateOrNull(data.earnedAt),
    reason: typeof reason === "string" ? reason : null,
  };
}

/**
 * Fetch every badge earned by `uid`, newest grant first.
 *
 * Returns `[]` for an unusable uid and for an empty collection. Malformed
 * docs are logged and skipped — this never throws on bad data. Transport
 * failures (offline, permission-denied) DO reject so the caller can render a
 * retry affordance instead of a silently empty ribbon.
 */
export async function fetchAchievements(uid: string): Promise<Achievement[]> {
  if (!isValidUid(uid)) return [];

  const snap = await withRetry(() => getDocs(collection(requireDb(), "users", uid, "achievements")));

  const achievements: Achievement[] = [];
  for (const docSnap of snap.docs) {
    try {
      const parsed = toAchievement(docSnap);
      if (parsed) {
        achievements.push(parsed);
      } else {
        logger.warn("malformed_achievement_doc", { uid, docId: docSnap.id });
      }
    } catch (err) {
      logger.warn("achievement_doc_parse_failed", { uid, docId: docSnap.id, error: parseFirebaseError(err) });
    }
  }

  return achievements.sort(
    (a, b) => (b.earnedAt?.getTime() ?? UNDATED_SORT_KEY) - (a.earnedAt?.getTime() ?? UNDATED_SORT_KEY),
  );
}
