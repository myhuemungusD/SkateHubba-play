import { revokeAccessToken, type User } from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { requireAuth } from "../firebase";
import { parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";

/**
 * App Store Review Guideline 5.1.1(v): an app that offers Sign in with Apple
 * must revoke the user's Apple tokens when they delete their account, so the
 * app disappears from the user's "Apps Using Apple ID" list.
 *
 * Revocation needs a fresh Apple authorization code, which only comes from an
 * Apple sign-in sheet. So on native, for an account linked to Apple, we show
 * the Apple sheet once (Face ID, like Instagram or Strava do on delete) and
 * hand the code to Firebase's `revokeAccessToken`, which calls Apple's
 * revoke endpoint for us.
 *
 * Returns "cancelled" when the user dismisses the sheet, so the caller can
 * stop before anything is deleted. Any other failure is logged and deletion
 * goes ahead: a revoke error must never strand someone in an account they
 * asked to remove.
 */
export type AppleRevokeOutcome = "not-apple" | "revoked" | "cancelled" | "failed";

export async function revokeAppleTokensIfNeeded(user: User): Promise<AppleRevokeOutcome> {
  const isApple = user.providerData?.some((p) => p.providerId === "apple.com") === true;
  if (!isApple || !Capacitor.isNativePlatform()) return "not-apple";

  let code: string | undefined;
  try {
    const { credential } = await FirebaseAuthentication.signInWithApple();
    code = credential?.authorizationCode;
  } catch (err) {
    const text = parseFirebaseError(err);
    if (/\b1001\b/.test(text) || /cancel/i.test(text)) {
      logger.info("apple_revoke_cancelled", { uid: user.uid });
      return "cancelled";
    }
    logger.warn("apple_revoke_reauth_failed", { uid: user.uid, message: text });
    return "failed";
  }
  if (!code) {
    logger.warn("apple_revoke_no_code", { uid: user.uid });
    return "failed";
  }
  try {
    await revokeAccessToken(requireAuth(), code);
    logger.info("apple_revoke_done", { uid: user.uid });
    return "revoked";
  } catch (err) {
    logger.warn("apple_revoke_failed", { uid: user.uid, message: parseFirebaseError(err) });
    return "failed";
  }
}
