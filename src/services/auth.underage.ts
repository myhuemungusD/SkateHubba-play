import { deleteUser } from "firebase/auth";
import { requireAuth } from "../firebase";
import { captureException } from "../lib/sentry";
import { getErrorCode } from "../utils/helpers";
import { signOut } from "./auth";
import { logger } from "./logger";
import { markCoppaBlocked } from "../utils/coppaNotice";

/**
 * COPPA: remove the Auth account of someone the age gate just blocked.
 *
 * Google and Apple sign-up create the Firebase Auth user (email, name, photo
 * URL) before ProfileSetup asks for a date of birth, so an under-13 block there
 * happens after an account already exists. The blocked card promises "No
 * account has been created", and the privacy policy promises we keep nothing
 * from under-13s, so the account has to go, not just the form.
 *
 * There is no Firestore profile yet (the block stops createProfile), so a
 * client `deleteUser` is enough; the server erasure endpoint is for accounts
 * with data. A just-made sign-in passes Firebase's recent-login check. If the
 * delete still fails (offline, an old resumed session), we sign out so the
 * device holds no session, and report it so the orphan can be removed.
 *
 * `signOut` runs in both cases: on native it also clears the platform
 * Google/Apple session, which `deleteUser` does not touch.
 *
 * It first marks the one-shot landing notice (utils/coppaNotice), because the
 * sign-out unmounts the screen that showed the blocked card. Never rejects:
 * the caller fires and forgets.
 */
export type UnderageBlockOutcome = "deleted" | "signed_out" | "failed" | "no_user";

export async function blockUnderageSignIn(): Promise<UnderageBlockOutcome> {
  markCoppaBlocked();
  const user = requireAuth().currentUser;
  if (!user) return "no_user";
  const uid = user.uid;
  try {
    await deleteUser(user);
    logger.info("underage_auth_deleted", { uid });
    await signOut().catch(() => undefined);
    return "deleted";
  } catch (err) {
    const code = getErrorCode(err);
    logger.warn("underage_auth_delete_failed", { uid, code });
    captureException(err, { extra: { context: "blockUnderageSignIn", uid, code } });
    try {
      await signOut();
      return "signed_out";
    } catch (signOutErr) {
      logger.warn("underage_sign_out_failed", { uid, code: getErrorCode(signOutErr) });
      return "failed";
    }
  }
}
