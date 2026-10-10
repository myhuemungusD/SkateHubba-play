/**
 * TOTP (authenticator app) enrollment and removal.
 *
 * Sign-in challenges stay in `mfa.ts`. This module is the Settings flow:
 * start enrollment (QR + manual key), confirm a code, or unenroll. Firebase
 * requires a recent sign-in for all three, and TOTP itself has to be turned
 * on in the Firebase project (Identity Platform). That project switch is
 * documented in `docs/MFA_TOTP.md` — this code only detects when it is off.
 */
import { Capacitor } from "@capacitor/core";
import { FirebaseAuthentication } from "@capacitor-firebase/authentication";
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  TotpMultiFactorGenerator,
  multiFactor,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type MultiFactorInfo,
  type TotpSecret,
  type User,
} from "firebase/auth";
import { requireAuth } from "../firebase";
import { getErrorCode, parseFirebaseError } from "../utils/errors";
import { logger } from "./logger";

/** Thrown for enrollment failures the Settings screen branches on. */
export class MfaFlowError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "MfaFlowError";
    this.code = code;
  }
}

/** TOTP is not enabled for this Firebase project (Identity Platform). */
export const MFA_UNAVAILABLE = "mfa/unavailable";

const TOTP_ISSUER = "SkateHubba";
const TOTP_DISPLAY_NAME = "Authenticator app";

/**
 * `auth/operation-not-allowed` is what Auth returns when the TOTP provider
 * is switched off in the console. The environment code shows up on projects
 * that have not been upgraded to Identity Platform at all.
 */
const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  "auth/operation-not-allowed",
  "auth/operation-not-supported-in-this-environment",
]);

export interface TotpSetup {
  /** SDK secret required to finish enrollment. Not a display value. */
  secret: TotpSecret;
  /** Manual entry key, shown when the QR cannot be scanned. */
  secretKey: string;
  /** otpauth:// URL encoded by the QR image. */
  qrCodeUrl: string;
}

export type ReauthMethod = "password" | "google" | "apple" | "unsupported";

function currentUser(): User {
  const user = requireAuth().currentUser;
  if (!user) throw new MfaFlowError("mfa/signed-out", "Sign in to change two-step verification.");
  return user;
}

function rejectMapped(err: unknown, op: string): never {
  const code = getErrorCode(err);
  logger.warn(op, { code, message: parseFirebaseError(err) });
  if (code === "auth/requires-recent-login") {
    throw new MfaFlowError(code, "Confirm it's you, then try again.");
  }
  if (UNAVAILABLE_CODES.has(code)) {
    throw new MfaFlowError(MFA_UNAVAILABLE, "Two-step verification isn't available yet.");
  }
  if (code === "auth/invalid-verification-code") {
    throw new MfaFlowError(code, "That code didn't match. Check the app and try again.");
  }
  throw err;
}

/** Enrolled authenticator factors for the signed-in user. Empty when signed out or Auth is not ready. */
export function listTotpFactors(): MultiFactorInfo[] {
  try {
    const user = requireAuth().currentUser;
    if (!user) return [];
    return multiFactor(user).enrolledFactors.filter((factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID);
  } catch (err) {
    logger.warn("mfa_totp_list_failed", { code: getErrorCode(err), message: parseFirebaseError(err) });
    return [];
  }
}

/**
 * Start TOTP enrollment. The returned secret must be passed back to
 * {@link confirmTotpEnrollment}; the key and URL are what the screen shows.
 */
export async function beginTotpEnrollment(): Promise<TotpSetup> {
  const user = currentUser();
  try {
    const session = await multiFactor(user).getSession();
    const secret = await TotpMultiFactorGenerator.generateSecret(session);
    const account = user.email ?? user.uid;
    return {
      secret,
      secretKey: secret.secretKey,
      qrCodeUrl: secret.generateQrCodeUrl(account, TOTP_ISSUER),
    };
  } catch (err) {
    rejectMapped(err, "mfa_totp_begin_failed");
  }
}

/** Finish enrollment with the 6-digit code from the authenticator app. */
export async function confirmTotpEnrollment(secret: TotpSecret, code: string): Promise<void> {
  const user = currentUser();
  const trimmed = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(trimmed)) {
    throw new MfaFlowError("mfa/invalid-code", "Enter the 6-digit code from your authenticator app.");
  }
  try {
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, trimmed);
    await multiFactor(user).enroll(assertion, TOTP_DISPLAY_NAME);
    logger.info("mfa_totp_enrolled", { uid: user.uid });
  } catch (err) {
    rejectMapped(err, "mfa_totp_enroll_failed");
  }
}

/** Remove one enrolled authenticator factor by its enrollment id. */
export async function unenrollTotpFactor(factorUid: string): Promise<void> {
  const user = currentUser();
  if (factorUid.length === 0) throw new MfaFlowError("mfa/invalid-factor", "No authenticator to remove.");
  try {
    await multiFactor(user).unenroll(factorUid);
    logger.info("mfa_totp_unenrolled", { uid: user.uid });
  } catch (err) {
    rejectMapped(err, "mfa_totp_unenroll_failed");
  }
}

/** How the signed-in user can prove a recent sign-in. Password wins when it is linked. */
export function reauthMethod(): ReauthMethod {
  let user: User | null;
  try {
    user = requireAuth().currentUser;
  } catch (err) {
    logger.warn("mfa_reauth_method_failed", { code: getErrorCode(err), message: parseFirebaseError(err) });
    return "unsupported";
  }
  if (!user) return "unsupported";
  const ids = new Set(user.providerData.map((provider) => provider.providerId));
  if (ids.has("password")) return "password";
  if (ids.has("google.com")) return "google";
  if (ids.has("apple.com")) return "apple";
  return "unsupported";
}

async function reauthWithGoogle(user: User): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { credential } = await FirebaseAuthentication.signInWithGoogle();
    if (!credential?.idToken) throw new Error("Google sign-in returned no idToken");
    const cred = GoogleAuthProvider.credential(credential.idToken, credential.accessToken);
    await reauthenticateWithCredential(user, cred);
    return;
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  await reauthenticateWithPopup(user, provider);
}

async function reauthWithApple(user: User): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { credential } = await FirebaseAuthentication.signInWithApple();
    const idToken = credential?.idToken;
    const nonce = credential?.nonce;
    if (!idToken || !nonce) throw new Error("Apple sign-in returned no idToken");
    const appleCred = new OAuthProvider("apple.com").credential({ idToken, rawNonce: nonce });
    await reauthenticateWithCredential(user, appleCred);
    return;
  }
  const provider = new OAuthProvider("apple.com");
  provider.addScope("email");
  provider.addScope("name");
  await reauthenticateWithPopup(user, provider);
}

/**
 * Refresh the sign-in so a following enroll or unenroll can pass the
 * recent-login requirement. `password` is required only for email accounts.
 */
export async function reauthenticateForMfa(password?: string): Promise<void> {
  const user = currentUser();
  const method = reauthMethod();
  try {
    if (method === "password") {
      const email = user.email;
      if (!email || !password) {
        throw new MfaFlowError("mfa/password-required", "Enter your password to continue.");
      }
      await reauthenticateWithCredential(user, EmailAuthProvider.credential(email, password));
      logger.info("mfa_reauth_ok", { uid: user.uid, method });
      return;
    }
    if (method === "google") {
      await reauthWithGoogle(user);
      logger.info("mfa_reauth_ok", { uid: user.uid, method });
      return;
    }
    if (method === "apple") {
      await reauthWithApple(user);
      logger.info("mfa_reauth_ok", { uid: user.uid, method });
      return;
    }
    throw new MfaFlowError("mfa/unsupported-provider", "Sign out and sign back in, then try again.");
  } catch (err) {
    if (err instanceof MfaFlowError) throw err;
    logger.warn("mfa_reauth_failed", { code: getErrorCode(err), message: parseFirebaseError(err) });
    throw err;
  }
}
