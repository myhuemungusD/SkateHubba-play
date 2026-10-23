import { collection, documentId, getDocs, limit, query, where } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { getUserProfile, type UserProfile } from "./users";

/** Most handles one prefix lookup returns. */
export const PREFIX_SEARCH_LIMIT = 8;

/** Reservation keys are lowercase alphanumerics + underscore (see USERNAME_RE). */
const PREFIX_RE = /^[a-z0-9_]{1,20}$/;

/**
 * Search every skater by handle prefix, not just the newest 100 the player
 * directory holds. `usernames/{handle}` reservation docs are keyed by the
 * lowercase handle and readable by any signed-in user, so a documentId()
 * range query finds older accounts without a rules change.
 *
 * The prefix is lowercased and trimmed. Anything that can't be a handle
 * returns [] without a read. Reservations whose profile is gone (stale
 * handles) are skipped, and `excludeUids` drops the caller and blocked users.
 */
export async function searchPlayersByPrefix(
  rawPrefix: string,
  excludeUids: ReadonlySet<string> = new Set(),
  max: number = PREFIX_SEARCH_LIMIT,
): Promise<UserProfile[]> {
  const prefix = rawPrefix.trim().replace(/^@+/, "").toLowerCase();
  if (!PREFIX_RE.test(prefix)) return [];

  const q = query(
    collection(requireDb(), "usernames"),
    where(documentId(), ">=", prefix),
    where(documentId(), "<", `${prefix}\uf8ff`),
    // Over-fetch a little so excluded handles don't leave the list short.
    limit(Math.min(max + excludeUids.size, 50)),
  );
  const snap = await withRetry(() => getDocs(q));

  const uids: string[] = [];
  for (const d of snap.docs) {
    const uid = (d.data() as { uid?: unknown }).uid;
    if (typeof uid === "string" && !excludeUids.has(uid) && !uids.includes(uid)) uids.push(uid);
  }

  const profiles = await Promise.all(uids.slice(0, max).map((uid) => getUserProfile(uid)));
  return profiles.filter((p): p is UserProfile => p !== null);
}
