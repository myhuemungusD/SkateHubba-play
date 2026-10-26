import type { Auth, User } from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { requireAuth } from "../firebase";
import { captureMessage } from "../lib/sentry";
import { parseFirebaseError } from "../utils/helpers";
import { hashUid } from "../utils/pii";
import { logger } from "./logger";

/**
 * App Store Review Guideline 5.1.1(v): an app that offers Sign in with Apple
 * must revoke the user's Apple tokens when they delete their account, so the
 * app disappears from the user's "Apps Using Apple ID" list.
 *
 * Revocation needs a fresh Apple authorization code, which only comes from an
 * Apple sign-in sheet. So on native, for an account linked to Apple, we show
 * the Apple sheet once (Face ID, like Instagram or Strava do on delete) and
 * hand the code to Identity Toolkit's `accounts:revokeToken`, which exchanges
 * it with Apple and revokes the resulting tokens.
 *
 * Returns "cancelled" when the user dismisses the sheet, so the caller can
 * stop before anything is deleted. Any other failure is logged and deletion
 * goes ahead: a revoke error must never strand someone in an account they
 * asked to remove.
 */
export type AppleRevokeOutcome = "not-apple" | "revoked" | "cancelled" | "failed";

/** Hard cap on the revoke round trip. Deletion must never wait on it longer. */
export const APPLE_REVOKE_TIMEOUT_MS = 10_000;

/**
 * Why not the SDK helpers:
 *
 *  - Web `revokeAccessToken(auth, token)` always sends
 *    `tokenType: "ACCESS_TOKEN"` (@firebase/auth `AuthImpl.revokeAccessToken`).
 *    The native Apple sheet yields an authorization code, not an access token,
 *    so that call is rejected.
 *  - The plugin's `FirebaseAuthentication.revokeAccessToken` calls iOS
 *    `Auth.auth().revokeToken(withAuthorizationCode:)`, which runs inside
 *    `_currentUser?.internalGetToken { … }`. We sign in with
 *    `skipNativeAuth: true`, so the native current user is nil, the
 *    completion never fires, and deletion would hang forever.
 *
 * So this sends the request those SDKs send, with the token type the code
 * actually is. Contract (Identity Toolkit v2 discovery doc,
 * `GoogleCloudIdentitytoolkitV2RevokeTokenRequest`): POST
 * `v2/accounts:revokeToken?key=API_KEY` with `providerId: "apple.com"`,
 * `tokenType: "CODE"` ("Token type is authorization_code"; "If an
 * authorization_code is passed in, the API will first exchange the code for
 * access token and then revoke the token exchanged"), `token` and the user's
 * Firebase `idToken`. firebase-ios-sdk's `RevokeTokenRequest` sends exactly
 * these four fields with the same enum (`authorizationCode = 3`) and no
 * `redirectUri`, which a native Apple code has none of.
 */
function revokeTokenUrl(auth: Auth): string {
  const { apiHost, apiScheme, apiKey } = auth.config;
  const path = `${apiHost}/v2/accounts:revokeToken?key=${encodeURIComponent(apiKey)}`;
  const emu = auth.emulatorConfig;
  if (emu) return `${emu.protocol}://${emu.host}${emu.port === null ? "" : `:${emu.port}`}/${path}`;
  return `${apiScheme}://${path}`;
}

class RevokeTimeoutError extends Error {
  constructor() {
    super(`apple revoke timed out after ${APPLE_REVOKE_TIMEOUT_MS}ms`);
    this.name = "RevokeTimeoutError";
  }
}

async function revokeAuthorizationCode(auth: Auth, user: User, code: string): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RevokeTimeoutError());
      controller.abort();
    }, APPLE_REVOKE_TIMEOUT_MS);
  });
  try {
    // The ID token refresh is inside the deadline too: it is a network call.
    await Promise.race([
      (async () => {
        const idToken = await user.getIdToken();
        const body: Record<string, string> = { providerId: "apple.com", tokenType: "CODE", token: code, idToken };
        if (auth.tenantId) body.tenantId = auth.tenantId;
        const res = await fetch(revokeTokenUrl(auth), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          referrerPolicy: "strict-origin-when-cross-origin",
          signal: controller.signal,
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => null)) as { error?: { message?: unknown } } | null;
          const reason = typeof err?.error?.message === "string" ? err.error.message : `http-${res.status}`;
          throw new Error(`revokeToken rejected: ${reason}`);
        }
      })(),
      timeout,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Log a fail-open outcome. The breadcrumb logger redacts uid; the Sentry event
 * carries only the hashed uid (same rule as auth.deleteAccount) so client and
 * server delete logs correlate without the raw id leaving the device.
 */
function reportFailure(user: User, stage: string, message?: string): "failed" {
  logger.warn(`apple_revoke_${stage}`, { uid: user.uid, ...(message ? { message } : {}) });
  captureMessage(`Sign in with Apple token revoke ${stage}`, {
    level: "warning",
    extra: { context: "account deletion continues without Apple revoke", uidHash: hashUid(user.uid), stage, message },
  });
  return "failed";
}

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
    return reportFailure(user, "reauth_failed", text);
  }
  if (!code) return reportFailure(user, "no_code");
  try {
    await revokeAuthorizationCode(requireAuth(), user, code);
    logger.info("apple_revoke_done", { uid: user.uid });
    return "revoked";
  } catch (err) {
    return reportFailure(user, err instanceof RevokeTimeoutError ? "timeout" : "failed", parseFirebaseError(err));
  }
}
