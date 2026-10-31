import { captureMessage } from "../lib/sentry";
import { getErrorCode } from "../utils/helpers";

/**
 * Classifiers for the errors the native sign-in sheets (Sign in with Apple,
 * Google Sign-In) hand back through `@capacitor-firebase/authentication`.
 *
 * Why most of this reads the message: the plugin (v8.5.2) rejects with
 * `call.reject(error.localizedDescription, createErrorCode(error))`, and
 * `createErrorCode` only knows Firebase `AuthErrorCode` values (17xxx). Apple's
 * `ASAuthorizationError` codes (1000, 1001) and Google's `GIDSignInErrorCode`
 * values have no entry, so the JS error arrives with NO `code`, and the
 * message is the only place the cause survives.
 */

/** The user closed a sign-in sheet. The UI treats this code as a silent dismiss. */
export const SIGN_IN_DISMISSED_CODE = "auth/popup-closed-by-user";

/** A native sign-in sheet could not run on this device. Not a Firebase code. */
export const SIGN_IN_UNAVAILABLE_CODES = {
  apple: "sign-in/apple-unavailable",
  google: "sign-in/google-unavailable",
} as const;

export type NativeSignInMethod = keyof typeof SIGN_IN_UNAVAILABLE_CODES;

/**
 * Error codes that mean the user closed the Apple sheet: what the plugin maps
 * `AuthErrorCode.webContextCancelled` / `webContextAlreadyPresented` to
 * (FirebaseAuthenticationHelper.swift).
 */
const APPLE_CANCEL_CODES: ReadonlySet<string> = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request"]);

function messageOf(err: unknown): string {
  const message = (err as { message?: unknown } | null)?.message;
  return typeof message === "string" ? message : "";
}

/**
 * True for an `ASAuthorizationError` with the given code: as a numeric or
 * string `code` (in case a bridge ever passes Apple's code through), or as
 * the NSError domain + code in the message, which is how the plugin surfaces
 * it: "The operation couldn’t be completed.
 * (com.apple.AuthenticationServices.AuthorizationError error 1001.)". It
 * matches the exact domain + code pair, not free text such as "cancel", so a
 * network "request cancelled" is never mistaken for the user closing the
 * sheet. The word between them is localized ("Fehler", "erreur", "エラー"), so
 * any short non-digit run is allowed there.
 */
function hasAppleAuthorizationError(err: unknown, code: number): boolean {
  if (typeof err === "object" && err !== null && (err as { code?: unknown }).code === code) return true;
  if (getErrorCode(err) === String(code)) return true;
  return new RegExp(`AuthorizationError\\D{1,20}${code}\\b`).test(messageOf(err));
}

/** True when the Apple sheet was closed by the user (`ASAuthorizationError.canceled`, 1001). */
export function isAppleSheetCancel(err: unknown): boolean {
  return APPLE_CANCEL_CODES.has(getErrorCode(err)) || hasAppleAuthorizationError(err, 1001);
}

/**
 * True for `ASAuthorizationError.unknown` (1000): the Apple sheet failed and
 * Apple doesn't say why. It is not a cancel. It is commonly reported on
 * devices with no usable Apple Account, on the simulator, and for builds
 * whose provisioning profile lacks the Sign in with Apple capability.
 */
export function isAppleSignInUnavailable(err: unknown): boolean {
  return hasAppleAuthorizationError(err, 1000);
}

/**
 * Google Sign-In's fixed English strings (GIDSignIn.m and AppAuth's
 * OIDAuthorizationService.m; neither is localized), compared exactly so no
 * other error text can match.
 * - Cancel: every AppAuth user/program cancel becomes `kGIDSignInErrorCodeCanceled`
 *   with this message.
 * - Unable to open Safari: AppAuth could not start its web sign-in session
 *   (`ASWebAuthenticationSession` refused to start, Guided Access is on, or a
 *   previous Google flow is still marked in progress).
 */
const GOOGLE_CANCEL_MESSAGE = "The user canceled the sign-in flow.";
const GOOGLE_CANNOT_PRESENT_MESSAGE = "Unable to open Safari.";

/** True when the user closed the Google sign-in sheet. */
export function isGoogleSheetCancel(err: unknown): boolean {
  return messageOf(err) === GOOGLE_CANCEL_MESSAGE;
}

/** True when Google Sign-In could not present its sign-in sheet. */
export function isGoogleSignInUnavailable(err: unknown): boolean {
  return messageOf(err) === GOOGLE_CANNOT_PRESENT_MESSAGE;
}

/** The error the UI receives for a closed sheet: a silent dismiss, original kept as `cause`. */
export function signInDismissedError(method: NativeSignInMethod, err: unknown): Error {
  const brand = method === "apple" ? "Apple" : "Google";
  return Object.assign(new Error(`${brand} sign-in was cancelled`), { code: SIGN_IN_DISMISSED_CODE, cause: err });
}

/** Why a native sign-in sheet could not run. Short, fixed strings so Sentry can group them. */
export type SignInUnavailableReason = "apple_authorization_unknown" | "google_cannot_present";

const UNAVAILABLE_DETAIL: Record<NativeSignInMethod, { reason: SignInUnavailableReason; nativeCode: string }> = {
  apple: { reason: "apple_authorization_unknown", nativeCode: "1000" },
  // GIDSignIn re-wraps every non-cancel AppAuth failure as kGIDSignInErrorCodeUnknown.
  google: { reason: "google_cannot_present", nativeCode: "-1" },
};

/**
 * Sends one Sentry warning for a sign-in sheet that could not run, and returns
 * the error the UI maps to "use Email instead". Only the method, the fixed reason and the
 * native code go out, never the raw error text (it can carry device or
 * account details); the event also goes through the redaction in `lib/sentry`.
 */
export function reportSignInUnavailable(method: NativeSignInMethod, err: unknown): Error {
  const { reason, nativeCode } = UNAVAILABLE_DETAIL[method];
  captureMessage("sign_in_unavailable", {
    level: "warning",
    tags: { sign_in: "unavailable", sign_in_method: method, sign_in_reason: reason },
    extra: { method, reason, nativeCode },
  });
  const code = SIGN_IN_UNAVAILABLE_CODES[method];
  return Object.assign(new Error(`${method}_sign_in_unavailable`), { code, cause: err });
}
