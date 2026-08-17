/**
 * Read-side service for the Economy Phase A locker (owned gear/cosmetics).
 *
 * Data model
 * ──────────
 *   users/{uid}/locker/{itemId}
 *     type:       string  — "deck" | "wheels" | "trucks" | "shoes" |
 *                           "apparel" | "accessory" | "limited"
 *     brand:      string
 *     name:       string
 *     imageUrl:   string
 *     rarity:     string  — "common" | "uncommon" | "rare" | "limited"
 *     acquiredAt: Timestamp
 *     provenance: { reason: string, … }
 *
 * `type` and `rarity` are read as plain strings, NOT narrowed unions. The
 * catalogue is server-owned: a new gear type shipped by the backend must show
 * up in the locker instead of being dropped by a client-side allowlist. The UI
 * is responsible for falling back to a default icon/treatment on a value it
 * doesn't recognise.
 *
 * Items are minted Admin-SDK-only (`firestore.rules` → users/{uid}/locker
 * denies client create/update), so this module is read-only by design.
 *
 * Ordering is done in memory rather than with a Firestore `orderBy` for the
 * same reason as `achievements.ts`: a server-side orderBy silently drops docs
 * missing the sort field.
 */

import { collection, getDocs } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";

/** One owned item on `users/{uid}/locker`. */
export interface LockerItem {
  /** Firestore doc id. */
  id: string;
  /** Catalogue category. Any non-empty string — see the module note. */
  type: string;
  /** Brand name. Empty string when the server hasn't set one. */
  brand: string;
  /** Display name. Guaranteed non-empty (items without one are skipped). */
  name: string;
  /** Artwork URL, or `null` when missing/blank/malformed. */
  imageUrl: string | null;
  /** Rarity tier. Defaults to {@link DEFAULT_RARITY} when absent. */
  rarity: string;
  /** Acquisition time, or `null` when missing or not a Timestamp. */
  acquiredAt: Date | null;
  /** `provenance.reason` — how the item was earned. `null` when absent. */
  provenanceReason: string | null;
}

/**
 * Minimal structural view of a query doc snapshot — see the matching note in
 * `achievements.ts`.
 */
interface ParsableDoc {
  id: string;
  data: () => unknown;
}

/**
 * Rarity assumed for docs written before the field existed. The lowest tier is
 * the safe default: an unknown item must never render as a rare one.
 */
const DEFAULT_RARITY = "common";

/**
 * Sort key for docs with no `acquiredAt` — pushes them to the end of the
 * descending sort. `Array#sort` is stable, so ties keep Firestore order.
 */
const UNDATED_SORT_KEY = Number.MIN_SAFE_INTEGER;

/** See `achievements.ts` — structural Timestamp detection, `null` on anything else. */
function toDateOrNull(value: unknown): Date | null {
  if (!value || typeof value !== "object") return null;
  const toDate = (value as { toDate?: unknown }).toDate;
  if (typeof toDate !== "function") return null;
  const date: unknown = toDate.call(value);
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** See `achievements.ts` — uid is a path segment, so it is validated first. */
function isValidUid(uid: string): boolean {
  return typeof uid === "string" && uid.length > 0 && !uid.includes("/");
}

/** Pull `provenance.reason` out of a tolerantly-typed provenance blob. */
function toProvenanceReason(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const reason = (value as { reason?: unknown }).reason;
  return typeof reason === "string" ? reason : null;
}

/**
 * Parse one locker doc. Returns `null` when the item has nothing renderable —
 * a tile with no name or no type is a blank square, so it's dropped rather
 * than shown.
 */
function toLockerItem(snap: ParsableDoc): LockerItem | null {
  const raw: unknown = snap.data();
  if (!raw || typeof raw !== "object") return null;
  if (typeof snap.id !== "string" || snap.id.length === 0) return null;

  const data = raw as Record<string, unknown>;
  const name = data.name;
  const type = data.type;
  if (!isNonEmptyString(name) || !isNonEmptyString(type)) return null;

  const brand = data.brand;
  const imageUrl = data.imageUrl;
  const rarity = data.rarity;

  return {
    id: snap.id,
    type,
    brand: typeof brand === "string" ? brand : "",
    name,
    // A blank imageUrl must become null: an empty `src` makes browsers
    // re-request the current page instead of rendering the fallback.
    imageUrl: isNonEmptyString(imageUrl) ? imageUrl : null,
    rarity: isNonEmptyString(rarity) ? rarity : DEFAULT_RARITY,
    acquiredAt: toDateOrNull(data.acquiredAt),
    provenanceReason: toProvenanceReason(data.provenance),
  };
}

/**
 * Fetch every item owned by `uid`, most recently acquired first.
 *
 * Returns `[]` for an unusable uid and for an empty locker. Malformed docs are
 * logged and skipped — this never throws on bad data. Transport failures
 * (offline, permission-denied) DO reject so the caller can render a retry
 * affordance instead of a silently empty locker.
 */
export async function fetchLockerItems(uid: string): Promise<LockerItem[]> {
  if (!isValidUid(uid)) return [];

  const snap = await withRetry(() => getDocs(collection(requireDb(), "users", uid, "locker")));

  const items: LockerItem[] = [];
  for (const docSnap of snap.docs) {
    try {
      const parsed = toLockerItem(docSnap);
      if (parsed) {
        items.push(parsed);
      } else {
        logger.warn("malformed_locker_doc", { uid, docId: docSnap.id });
      }
    } catch (err) {
      logger.warn("locker_doc_parse_failed", { uid, docId: docSnap.id, error: parseFirebaseError(err) });
    }
  }

  return items.sort(
    (a, b) => (b.acquiredAt?.getTime() ?? UNDATED_SORT_KEY) - (a.acquiredAt?.getTime() ?? UNDATED_SORT_KEY),
  );
}
