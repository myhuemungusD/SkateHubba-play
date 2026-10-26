/**
 * Store one device's push token for a user: the owner-only canonical list in
 * users/{uid}/private/profile.fcmTokens and the cross-readable mirror in
 * pushTargets/{uid} (tokens plus the per-token platform tag). The one copy
 * of the 10-token cap, used by both the native path
 * (src/services/pushNotifications.ts) and the web path (src/services/fcm.ts).
 *
 * The two writes are separate on purpose: each doc has its own rules, and a
 * partial write (private lands, mirror fails) heals on the next registration.
 * The private write goes first; callers rely on that order.
 */
import { doc, getDoc, setDoc, arrayUnion, serverTimestamp } from "firebase/firestore";
import type { requireDb } from "../firebase";
import { PRIVATE_PROFILE_DOC_ID } from "./users";
import { PUSH_TARGETS_COLLECTION } from "./pushDispatch";
import { tagFromMirror } from "./pushPlatform";

type Db = ReturnType<typeof requireDb>;

/**
 * Most tokens one user may store. firestore.rules caps both
 * users/{uid}/private/profile.fcmTokens and pushTargets/{uid}.tokens at 10.
 */
export const MAX_PUSH_TOKENS = 10;

/**
 * The token list to write when adding `token`, or null when `arrayUnion` is
 * enough (the stored list is clean and stays within the cap).
 *
 * WHY: the rules deny any write that leaves more than 10 entries, and they
 * check the whole stored list, not just what this write adds. At the cap,
 * `arrayUnion` would make an 11-entry list, so a new phone silently never
 * gets push. Worse, a list that is ALREADY over 10 (written before the cap
 * existed, or by an older build) used to be left alone when it already held
 * this token, so every save was denied and the iPhone app retried in a loop
 * (Sentry SKATEHUBBA-SENTRY-D). So whenever the stored list is over the cap,
 * or holds junk the rules would count, it is rewritten: duplicates and
 * non-strings dropped, the newest 9 other tokens kept (arrayUnion appends,
 * so the list runs oldest to newest), and this device last. A dropped token
 * belonged to a device that has not registered since; if it is still alive
 * it re-adds itself on its next sign-in.
 */
export function cappedTokenList(existing: unknown, token: string): string[] | null {
  const raw: unknown[] = Array.isArray(existing) ? existing : [];
  const clean = raw.every((t) => typeof t === "string");
  const has = raw.includes(token);
  if (clean && (has ? raw.length <= MAX_PUSH_TOKENS : raw.length < MAX_PUSH_TOKENS)) return null;
  // Newest occurrence wins, so walk from the end and keep first sightings.
  const others: string[] = [];
  for (let i = raw.length - 1; i >= 0 && others.length < MAX_PUSH_TOKENS - 1; i--) {
    const t = raw[i];
    if (typeof t === "string" && t !== token && !others.includes(t)) others.push(t);
  }
  return [...others.reverse(), token];
}

/** Add `token` to the private profile's fcmTokens, trimming at the cap. */
export async function storePrivateToken(db: Db, uid: string, token: string): Promise<void> {
  const privateRef = doc(db, "users", uid, "private", PRIVATE_PROFILE_DOC_ID);
  const snap = await getDoc(privateRef);
  const capped = cappedTokenList(snap.data()?.fcmTokens, token);
  await setDoc(privateRef, { fcmTokens: capped ?? arrayUnion(token) }, { merge: true });
}

/** Add `token` (tagged with this device's platform) to pushTargets/{uid}, trimming at the cap. */
export async function storeMirrorToken(db: Db, uid: string, token: string): Promise<void> {
  const mirrorRef = doc(db, PUSH_TARGETS_COLLECTION, uid);
  const snap = await getDoc(mirrorRef);
  const data = snap.data();
  const capped = cappedTokenList(data?.tokens, token);
  await setDoc(
    mirrorRef,
    {
      tokens: capped ?? arrayUnion(token),
      // With a trimmed list, tags for the dropped tokens are deleted too.
      ...tagFromMirror(token, capped ? { ...data, tokens: capped } : data),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** Both writes, private first (senders read the mirror; the canonical list leads). */
export async function storePushToken(db: Db, uid: string, token: string): Promise<void> {
  await storePrivateToken(db, uid, token);
  await storeMirrorToken(db, uid, token);
}
