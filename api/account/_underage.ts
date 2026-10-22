/**
 * COPPA: remove a sign-in the under-13 age gate just blocked.
 *
 * Google and Apple sign-up create the Firebase Auth user before ProfileSetup
 * asks for a date of birth. When the gate blocks, the client deletes that user
 * itself (`deleteUser`), but Firebase only allows that within about five
 * minutes of sign-in. A slow username form or a resumed session misses that
 * window, so the client falls back to `POST /api/account/delete?reason=underage`.
 *
 * Skipping the endpoint's recent-login check is safe only because nothing of
 * value can be lost: this path runs only when `users/{uid}` does not exist.
 * A caller with a real profile always goes through the normal erasure path,
 * recency check included, so a leaked token still can't erase an account.
 *
 * Before a profile exists the app can at most have written the docs below
 * (presence and push tokens; the client gates those on a profile now, so this
 * is the backstop for older builds and races).
 */
import type { Auth } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";

export const preProfileDocs = (uid: string): string[] => [
  `onlineStatus/${uid}`,
  `users/${uid}/private/profile`,
  `pushTargets/${uid}`,
];

/** True when the caller has a SkateHubba profile, so the underage path must not run. */
export async function hasProfile(db: Firestore, uid: string): Promise<boolean> {
  return (await db.doc(`users/${uid}`).get()).exists;
}

/** Delete the pre-profile docs, then the Auth user. Throws on any failure; both steps are idempotent. */
export async function eraseUnderageSignIn(db: Firestore, auth: Auth, uid: string): Promise<void> {
  const batch = db.batch();
  for (const path of preProfileDocs(uid)) batch.delete(db.doc(path));
  await batch.commit();
  await auth.deleteUser(uid);
}
