import { type User } from "firebase/auth";
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import { ensureAppCheck, isAppCheckInitialized, requireAuth } from "../firebase";
import { captureMessage } from "../lib/sentry";
import { errorKind } from "../utils/errors";
import { logger } from "./logger";
import { isAppleSheetCancel } from "./nativeSignInErrors";

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
 *     and the REST revoke. The helper swallows its own errors and returns
 *     an outcome; the caller decides what each one means. The delete flow
 *     (`auth.deleteAccount.ts`) stops with nothing deleted on both
 *     "cancelled" and "failed", so the user can retry.
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
    if (isAppleSheetCancel(err)) {
      logger.info("apple_revoke_cancelled", { uid: user.uid });
      return "cancelled";
    }
    logger.warn("apple_revoke_reauth_failed", { uid: user.uid, error: errorKind(err) });
    reportRevokeFailure("sheet_error");
    return "failed";
  }
  if (!code) {
    logger.warn("apple_revoke_no_code", { uid: user.uid });
    reportRevokeFailure("no_code");
    return "failed";
  }

  // Fresh budget for the network part only, starting now that the user is
  // done with the sheet. One AbortController bounds every step: the fetch is
  // cancelled for real (no socket left open, no late result nobody reads),
  // and the steps that can't take a signal are raced against it.
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const auth = requireAuth();
    const apiKey = auth.app.options.apiKey;
    if (!apiKey) {
      logger.warn("apple_revoke_no_api_key", { uid: user.uid });
      reportRevokeFailure("no_api_key");
      return "failed";
    }
    const idToken = await untilAborted(user.getIdToken(), ac.signal);
    const appCheck = await untilAborted(appCheckHeaderWithin(user.uid, APPCHECK_BUDGET_MS), ac.signal);
    const url = `https://identitytoolkit.googleapis.com/v2/accounts:revokeToken?key=${encodeURIComponent(apiKey)}`;
    const res = await untilAborted(
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...appCheck },
        body: JSON.stringify({
          idToken,
          providerId: "apple.com",
          tokenType: "CODE",
          token: code,
        }),
        signal: ac.signal,
      }),
      ac.signal,
    );
    if (!res.ok) {
      const apiError = await readApiErrorSymbol(res);
      logger.warn("apple_revoke_failed", {
        uid: user.uid,
        status: res.status,
        error: apiError ?? `http-${res.status}`,
      });
      reportRevokeFailure("http", { status: res.status, apiError });
      return "failed";
    }
    logger.info("apple_revoke_done", { uid: user.uid });
    return "revoked";
  } catch (err) {
    if (ac.signal.aborted) {
      logger.warn("apple_revoke_rest_timeout", { uid: user.uid, timeoutMs });
      reportRevokeFailure("timeout");
      return "failed";
    }
    logger.warn("apple_revoke_failed", { uid: user.uid, error: errorKind(err) });
    reportRevokeFailure("error");
    return "failed";
  } finally {
    clearTimeout(timer);
  }
}

/** Why a revoke didn't land. Short, fixed strings so Sentry can group them. */
export type RevokeFailureReason = "sheet_error" | "no_code" | "no_api_key" | "http" | "timeout" | "error" | "threw";

/**
 * One Sentry warning per revoke that didn't land, so a silent regression of
 * the 5.1.1(v) fix shows up somewhere other than a device log.
 *
 * Only the fixed reason, the HTTP status and the Identity Toolkit error symbol
 * go out. Never the Apple code, the ID token, the App Check token or the uid;
 * the event also goes through the redaction in `lib/sentry`. A user cancel is
 * not a failure and stays a breadcrumb.
 */
export function reportRevokeFailure(
  reason: RevokeFailureReason,
  detail: { status?: number; apiError?: string } = {},
): void {
  captureMessage("apple_revoke_failed", {
    level: "warning",
    tags: { apple_revoke: "failed", apple_revoke_reason: reason },
    extra: { reason, ...detail },
  });
}

/**
 * The leading `SCREAMING_CASE` symbol of an Identity Toolkit error message
 * (`"INVALID_ID_TOKEN"`, `"INVALID_IDP_RESPONSE : Unable to parse …"` →
 * `"INVALID_IDP_RESPONSE"`). The free-form tail is dropped: it can echo what
 * was sent, including the Apple code.
 */
function apiErrorSymbol(message: string): string | undefined {
  return /^[A-Z][A-Z0-9_]{0,63}/.exec(message)?.[0];
}

/**
 * `X-Firebase-AppCheck` for this hand-rolled Identity Toolkit call.
 *
 * The Firebase Auth SDK attaches this header to its own requests once App
 * Check is running; a raw `fetch` does not. App Check isn't enforced on Auth
 * today (docs/APPCHECK_ROLLOUT.md), but the day it is, a revoke without the
 * header would 401 and the 5.1.1(v) bug would come back silently.
 *
 * This only runs in the native shell, where the token comes from the native
 * plugin (App Attest / DeviceCheck) — the same source the web SDK is bridged
 * to in `lib/nativeAppCheck.ts`. Fail soft: if App Check is off or the token
 * can't be had, send no header and let the revoke try anyway. The token is
 * never logged.
 */
async function appCheckHeader(uid: string): Promise<Record<string, string>> {
  try {
    await ensureAppCheck();
    if (!isAppCheckInitialized()) return {};
    const { FirebaseAppCheck } = await import("@capacitor-firebase/app-check");
    const { token } = await FirebaseAppCheck.getToken({ forceRefresh: false });
    return token ? { "X-Firebase-AppCheck": token } : {};
  } catch {
    logger.warn("apple_revoke_appcheck_unavailable", { uid });
    return {};
  }
}

/**
 * Most of the revoke budget may go to App Check. App Attest can be slow on
 * a cold start, and App Check isn't enforced on Auth yet, so a stalled token
 * must not cost the revoke itself.
 */
const APPCHECK_BUDGET_MS = 2_000;

/** `appCheckHeader`, or no header if it takes longer than `ms`. */
function appCheckHeaderWithin(uid: string, ms: number): Promise<Record<string, string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Record<string, string>>((resolve) => {
    timer = setTimeout(() => {
      logger.warn("apple_revoke_appcheck_slow", { uid, budgetMs: ms });
      resolve({});
    }, ms);
  });
  return Promise.race([appCheckHeader(uid), late]).finally(() => clearTimeout(timer));
}

/**
 * Settle with `p`, or reject as soon as `signal` aborts. `fetch` honours the
 * signal itself; this also bounds `getIdToken()`, which takes none, and
 * guards against a fetch polyfill that ignores it.
 */
function untilAborted<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("apple_revoke_timeout"));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/**
 * The error symbol from an Identity Toolkit error body
 * (`{ error: { code, message, status } }`), or undefined if there is none.
 *
 * Only the leading symbol is kept. `message` is not always a bare symbol:
 * it can be `"SYMBOL : free text"`, and the free text can echo the request
 * (for example `"Unable to parse code: <the code>"`). Neither the raw body
 * nor the full message is ever logged or reported: logger breadcrumbs ride
 * along with the Sentry warning sent for the same failure.
 */
async function readApiErrorSymbol(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { message?: unknown; status?: unknown } } | null;
    const message = typeof body?.error?.message === "string" ? body.error.message : "";
    const status = typeof body?.error?.status === "string" ? body.error.status : "";
    return apiErrorSymbol(message) ?? apiErrorSymbol(status);
  } catch {
    return undefined;
  }
}
