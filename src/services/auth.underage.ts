import { deleteUser, type User } from "firebase/auth";
import { requireAuth } from "../firebase";
import { captureException } from "../lib/sentry";
import { getErrorCode } from "../utils/helpers";
import { hashUid } from "../utils/pii";
import { signOut } from "./auth";
import { accountDeleteUrl, CodedError } from "./auth.deleteAccount";
import { logger } from "./logger";
import { markAgeGateBlocked, markCoppaBlocked } from "../utils/coppaNotice";

/**
 * COPPA: remove the Auth account of someone the age gate just blocked.
 *
 * Google and Apple sign-up create the Firebase Auth user (email, name, photo
 * URL) before ProfileSetup asks for a date of birth, so an under-13 block there
 * happens after an account already exists. The privacy policy promises we keep
 * nothing from under-13s, so the account has to go, not just the form.
 *
 * Three steps, each a fallback for the one before:
 *  1. Client `deleteUser`. Firebase allows it only within about 5 minutes of
 *     sign-in, so a slow username form or a resumed session fails here with
 *     auth/requires-recent-login.
 *  2. The server endpoint's underage mode (`?reason=underage`), which skips the
 *     recency check only because no profile exists yet (api/account/_underage.ts).
 *  3. Sign out once the account is gone. On native that also clears the
 *     platform Google/Apple session, which `deleteUser` does not touch. If both
 *     deletes failed (say, offline) it stays signed in on purpose and returns
 *     "pending": ProfileSetup sees the sticky block on the next open and calls
 *     this again, so the deletion completes instead of being stranded with no
 *     token to retry with.
 *
 * It first sets the sticky 24-hour block and the landing notice
 * (utils/coppaNotice), because the sign-out unmounts the screen that showed the
 * blocked card. The notice says "pending" until a delete succeeds. Each call
 * re-marks the sticky block, so every pending retry restarts its 24 hours;
 * that is intended while a deletion is still outstanding. Never
 * rejects: the caller fires and forgets. Logs never carry the raw uid.
 */
export type UnderageBlockOutcome = "deleted" | "pending" | "no_user";

export async function blockUnderageSignIn(): Promise<UnderageBlockOutcome> {
  markAgeGateBlocked();
  markCoppaBlocked("pending");
  const user = requireAuth().currentUser;
  if (!user) return "no_user";
  const uidHash = hashUid(user.uid);
  if (!(await deleteBlockedUser(user, uidHash))) return "pending";
  markCoppaBlocked("deleted");
  try {
    await signOut();
  } catch (err) {
    // The account is already gone, so a failed sign-out only leaves a dead session.
    logger.warn("underage_sign_out_failed", { uidHash, code: getErrorCode(err) });
  }
  return "deleted";
}

async function deleteBlockedUser(user: User, uidHash: string): Promise<boolean> {
  let clientCode: string;
  try {
    await deleteUser(user);
    logger.info("underage_auth_deleted", { uidHash, via: "client" });
    return true;
  } catch (err) {
    clientCode = getErrorCode(err);
    logger.warn("underage_auth_delete_failed", { uidHash, code: clientCode });
  }
  try {
    await deleteViaServer(user);
    logger.info("underage_auth_deleted", { uidHash, via: "server" });
    return true;
  } catch (err) {
    const serverCode = getErrorCode(err);
    logger.warn("underage_server_delete_failed", { uidHash, code: serverCode });
    captureException(err, { extra: { context: "blockUnderageSignIn", uidHash, clientCode, serverCode } });
    return false;
  }
}

/** POST the endpoint's underage mode. Throws a coded error unless the server deleted the Auth user. */
async function deleteViaServer(user: User): Promise<void> {
  const url = accountDeleteUrl();
  if (!url) throw new CodedError("account-delete/misconfigured", "No API origin in this build");
  const res = await fetch(`${url}?reason=underage`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await user.getIdToken()}` },
  });
  if (res.ok) return;
  const body = (await res.json().catch(() => null)) as { code?: unknown } | null;
  throw new CodedError(`account-delete/${typeof body?.code === "string" ? body.code : res.status}`, "Server refused");
}
