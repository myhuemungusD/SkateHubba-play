/**
 * Per-user push notification preference.
 *
 * Product rule (owner, 2026-08): push is ON by default and can only be turned
 * off from the Settings screen. "Default on" is encoded as *absence*: a profile
 * with no `pushEnabled` field is enabled, so every existing user keeps push
 * without a migration and a failed read degrades to enabled rather than
 * silently muting someone.
 *
 * ENFORCEMENT — the preference is not a flag the sender is trusted to honor.
 * Disabling EMPTIES the cross-readable token mirror at /pushTargets/{uid}.
 * `dispatchPushNotification` (and the admin `dispatchAdminPush` in the cron)
 * both read that mirror and no-op on an empty token list, so a disabled user
 * receives nothing even from a stale or malicious sender. Re-enabling
 * re-acquires the device token — never by prompting: if OS permission was
 * never granted (or was revoked), the toggle flips the preference and the
 * mirror simply stays empty until the user grants permission through the
 * explicit permission flow.
 *
 * The canonical /users/{uid}/private/profile.fcmTokens list is deliberately
 * left alone. It is owner-only and unreadable by senders, so it cannot leak a
 * push to a disabled user, and keeping it means sign-out cleanup
 * (`unregisterPushToken`) still knows what to scrub.
 *
 * RULES DEPENDENCY: `pushEnabled` must be added to `privateProfileKeysOk()` in
 * firestore.rules (users/{uid}/private/{docId}) — that allowlist is fail-closed,
 * so the write is DENIED until rules-guardian lands it.
 */

import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { requireDb } from "../firebase";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { PRIVATE_PROFILE_DOC_ID } from "./users";
import { PUSH_TARGETS_COLLECTION } from "./pushDispatch";
import { isPushSupported, registerPushTokenIfGranted } from "./pushNotifications";
import { refreshWebPushTokenIfGranted } from "./fcm";

/**
 * Read the user's push preference (default: enabled).
 *
 * Implemented in users.ts so the token-registration paths can consult it
 * without a circular import; re-exported here so callers have one push-settings
 * module to import from.
 */
export { getPushEnabled } from "./users";

/**
 * Persist the user's push preference and bring the token mirror in line with it.
 *
 * Throws if the preference write fails — this one is user-initiated from
 * Settings, so the UI must be able to show "couldn't save" rather than lie
 * about the new state. The mirror reconciliation that follows is best-effort:
 * it is idempotent and re-runs on the next toggle or sign-in.
 */
export async function setPushEnabled(uid: string, enabled: boolean): Promise<void> {
  await setDoc(
    doc(requireDb(), "users", uid, "private", PRIVATE_PROFILE_DOC_ID),
    { pushEnabled: enabled },
    { merge: true },
  );

  if (!enabled) {
    await clearPushTargets(uid);
    return;
  }

  // Re-registration path. Both variants are permission-checking, never
  // permission-prompting: a Settings toggle must not be able to raise an OS
  // dialog the user didn't ask for.
  try {
    if (isPushSupported()) {
      await registerPushTokenIfGranted(uid);
    } else {
      await refreshWebPushTokenIfGranted(uid);
    }
  } catch (err) {
    logger.warn("push_pref_reregister_failed", { uid, error: parseFirebaseError(err) });
  }
}

/**
 * Empty the cross-readable token mirror. Writing `tokens: []` (rather than
 * deleting the doc) keeps the write inside the /pushTargets rule's
 * `hasOnly(['tokens','updatedAt'])` allowlist and leaves a live `updatedAt`
 * behind for dispatch-side staleness checks.
 */
async function clearPushTargets(uid: string): Promise<void> {
  try {
    await setDoc(
      doc(requireDb(), PUSH_TARGETS_COLLECTION, uid),
      { tokens: [], updatedAt: serverTimestamp() },
      { merge: true },
    );
  } catch (err) {
    logger.warn("push_pref_mirror_clear_failed", { uid, error: parseFirebaseError(err) });
  }
}
