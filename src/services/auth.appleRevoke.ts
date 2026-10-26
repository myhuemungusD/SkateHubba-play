import { type User } from "firebase/auth";
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
 * How this works end-to-end:
 *
 *  1. Revocation needs a fresh Apple authorization code. Codes expire fast
 *     and are single-use, so there is no way to cache one — we have to show
 *     the Apple sheet again (Face ID, like Instagram or Strava do on delete)
 *     and read `credential.authorizationCode` from the Capacitor result.
 *     The Capacitor shell is built with `skipNativeAuth: true`, so this
 *     native sheet is purely a credential grab; it does not touch the
 *     Firebase session the web SDK already owns.
 *
 *  2. The code is sent to Firebase's Identity Toolkit REST endpoint
 *     `v2/accounts:revokeToken` with `tokenType: "CODE"` and the signed-in
 *     user's ID token. Firebase then exchanges the code with Apple and calls
 *     Apple's `/auth/revoke` endpoint on our behalf, so the Apple Services
 *     ID / Team ID / Key ID / .p8 live only in the Firebase console.
 *
 *     The previous implementation called the Firebase Web SDK's
 *     `revokeAccessToken(auth, code)`. That helper always sends
 *     `tokenTypeHint: "ACCESS_TOKEN"`, so Apple's server rejected the
 *     authorization code and nothing was ever revoked — the warning was then
 *     swallowed because the delete flow treats revoke as best-effort. Hitting
 *     the REST endpoint directly lets us pass `tokenType: "CODE"`, which is
 *     the shape Apple actually accepts.
 *
 *     The native plugin's own `revokeAccessToken` is NOT an option here: with
 *     `skipNativeAuth: true` the Capacitor side never signed in, so it has no
 *     Apple user id to revoke against and the call blocks forever. Everything
 *     stays on the web SDK + REST path.
 *
 *  3. The Apple sheet itself is NOT timed. It is the user's own time (Face
 *     ID retry, typing an Apple ID password, reading the sheet), and
 *     `ASAuthorizationController` always calls back on success, error or
 *     dismissal; our sign-in path (`auth.ts`) awaits the same sheet with no
 *     limit. A deadline here used to fire while the sheet was still on
 *     screen, deleting the account and silently skipping the revoke.
 *
 *     Only once the sheet hands back a code does a fresh budget start, and it
 *     covers everything that touches the network: refreshing the ID token
 *     and the REST revoke. The helper swallows its own errors — Apple or
 *     Firebase being slow, or a 4xx, must not strand the user in an account
 *     they asked to delete. The caller decides what each outcome means.
 */
export type AppleRevokeOutcome = "not-apple" | "revoked" | "cancelled" | "failed";

const DEFAULT_TIMEOUT_MS = 8000;

export interface AppleRevokeOptions {
  /**
   * Cap on the network part of the revoke (ID token refresh + REST call),
   * started after the Apple sheet returns a code. The sheet is never timed.
   */
  timeoutMs?: number;
}

export async function revokeAppleTokensIfNeeded(
  user: User,
  opts: AppleRevokeOptions = {},
): Promise<AppleRevokeOutcome> {
  const isApple = user.providerData?.some((p) => p.providerId === "apple.com") === true;
  if (!isApple || !Capacitor.isNativePlatform()) return "not-apple";

  let code: string | undefined;
  try {
    // No deadline: see note 3 above. The sheet always settles on its own.
    const result = (await FirebaseAuthentication.signInWithApple()) as {
      credential?: { authorizationCode?: string };
    };
    code = result?.credential?.authorizationCode;
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

  // Fresh budget for the network part only, starting now that the user is
  // done with the sheet.
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());

  try {
    const auth = requireAuth();
    const apiKey = auth.app.options.apiKey;
    if (!apiKey) {
      logger.warn("apple_revoke_no_api_key", { uid: user.uid });
      return "failed";
    }
    const idToken = await withTimeout(user.getIdToken(), remaining(), "id_token");
    const url = `https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=${encodeURIComponent(apiKey)}`;
    const res = (await withTimeout(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken,
          providerId: "apple.com",
          tokenType: "CODE",
          token: code,
        }),
      }),
      remaining(),
      "rest",
    )) as Response;
    if (!res.ok) {
      const safeMessage = await readSafeErrorMessage(res);
      logger.warn("apple_revoke_failed", { uid: user.uid, status: res.status, message: safeMessage });
      return "failed";
    }
    logger.info("apple_revoke_done", { uid: user.uid });
    return "revoked";
  } catch (err) {
    const text = parseFirebaseError(err);
    if (/apple_revoke_timeout/.test(text)) {
      logger.warn("apple_revoke_rest_timeout", { uid: user.uid, timeoutMs });
      return "failed";
    }
    logger.warn("apple_revoke_failed", { uid: user.uid, message: text });
    return "failed";
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`apple_revoke_timeout:${label}`)), Math.max(0, ms));
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/**
 * Pull a non-sensitive status message out of an Identity Toolkit error body.
 * The body shape is `{ error: { code, message, status } }` where message is
 * an all-caps symbol like `INVALID_GRANT` — safe to log. We never log the
 * raw body: a defensive proxy or a future Firebase change could echo back
 * the submitted token or code, and those must not land in a log line.
 */
async function readSafeErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown; status?: unknown } } | null;
    const message = typeof body?.error?.message === "string" ? body.error.message : "";
    const status = typeof body?.error?.status === "string" ? body.error.status : "";
    return message || status || `http-${res.status}`;
  } catch {
    return `http-${res.status}`;
  }
}
