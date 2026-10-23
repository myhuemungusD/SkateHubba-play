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
 * value can be lost: this path erases only a sign-in with no `users/{uid}`
 * doc. With a profile it deletes nothing and answers `has_profile`, so a real
 * account is only ever erased through the normal path and its confirmation UI.
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

/**
 * - `has_profile`: the caller has a profile; nothing was touched.
 * - `erased`: the pre-profile docs and the Auth user are gone.
 * - `raced`: as `erased`, but a profile appeared after the Auth user was
 *   deleted, so `eraseProfile` ran the full cascade for it.
 */
export type UnderageOutcome = "has_profile" | "erased" | "raced";

/**
 * The Auth user is already gone but the late profile's cascade failed. A retry
 * can't fix this (the token no longer verifies), so the caller must report it
 * distinctly: the profile is orphaned until an operator erases it.
 */
export class RacedCascadeError extends Error {
  constructor(readonly inner: unknown) {
    super("underage raced cascade failed");
    this.name = "RacedCascadeError";
  }
}

/**
 * Race-safe erasure. Throws on any failure. Until the Auth user is deleted
 * every step is idempotent and the same token still verifies, so a retry
 * resumes.
 *
 * 1. Check for a profile (a cheap read that skips the transaction in the
 *    common `has_profile` case).
 * 2. Check again and delete the pre-profile docs in one transaction. The
 *    Admin SDK locks what it reads, so a concurrent `createProfile` commits
 *    strictly before (seen here) or after (caught in step 4).
 * 3. Delete the Auth user. That stops new ID tokens being minted.
 * 4. Re-check. An ID token minted earlier stays valid for Firestore for up to
 *    an hour, so a profile written in that window would be orphaned PII with
 *    no Auth user. Erase it; if that fails, throw `RacedCascadeError`.
 *
 * No refresh-token revoke: `verifyIdToken(token, true)` would then reject the
 * session for good, so a failure in step 2 or 3 could never be retried, and
 * step 3 already stops new tokens.
 */
export async function eraseUnderageSignIn(
  db: Firestore,
  auth: Auth,
  uid: string,
  eraseProfile: () => Promise<unknown>,
): Promise<UnderageOutcome> {
  const userRef = db.doc(`users/${uid}`);
  if ((await userRef.get()).exists) return "has_profile";
  const found = await db.runTransaction(async (tx) => {
    if ((await tx.get(userRef)).exists) return true;
    for (const path of preProfileDocs(uid)) tx.delete(db.doc(path));
    return false;
  });
  if (found) return "has_profile";
  await auth.deleteUser(uid);
  if (!(await userRef.get()).exists) return "erased";
  try {
    await eraseProfile();
  } catch (err) {
    throw new RacedCascadeError(err);
  }
  return "raced";
}
