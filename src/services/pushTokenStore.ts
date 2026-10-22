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
 * enough (the token is already there, or there is room).
 *
 * WHY: at the cap, `arrayUnion` would make an 11-entry list and the rules
 * deny the whole write, so a new browser or phone silently never gets push.
 * Instead the oldest entries drop (arrayUnion appends, so the list runs
 * oldest to newest) and the newest 9 plus this device remain. A dropped
 * token belonged to a device that has not registered since; if it is still
 * alive it re-adds itself on its next sign-in.
 */
export function cappedTokenList(existing: unknown, token: string): string[] | null {
  const list = Array.isArray(existing) ? existing.filter((t): t is string => typeof t === "string") : [];
  if (list.includes(token) || list.length < MAX_PUSH_TOKENS) return null;
  return [...list.slice(-(MAX_PUSH_TOKENS - 1)), token];
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
