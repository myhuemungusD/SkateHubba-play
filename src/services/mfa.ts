/**
 * Multi-factor (second factor) sign-in resolution.
 *
 * Firebase does not sign a user in when they have a second factor enrolled:
 * `signInWithEmailAndPassword` / `signInWithPopup` reject with
 * `auth/multi-factor-auth-required` and hand back an error object that carries
 * the pending session. Recovering from that error is a client-side flow, so it
 * lives here rather than in `auth.ts` — the sign-in entry points stay unchanged
 * and callers opt in by passing their caught error to {@link getMfaChallenge}.
 *
 * Two factor types are supported, matching what Identity Platform lets a user
 * enrol: phone (SMS) and TOTP (authenticator app). Phone needs a two-step
 * round trip (send code, then confirm); TOTP is single-step because the code
 * is generated on the user's device.
 */
import {
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  TotpMultiFactorGenerator,
  type MultiFactorError,
  type MultiFactorInfo,
  type MultiFactorResolver,
  type PhoneMultiFactorInfo,
  type User,
} from "firebase/auth";
import { requireAuth } from "../firebase";
import { getErrorCode, parseFirebaseError } from "../utils/helpers";
import { logger } from "./logger";

/** The Firebase Auth error code that signals a pending second-factor challenge. */
const MFA_REQUIRED_CODE = "auth/multi-factor-auth-required";

/** A pending multi-factor sign-in challenge extracted from a sign-in error. */
export interface MfaChallenge {
  resolver: MultiFactorResolver;
  hints: MultiFactorInfo[];
}

/**
 * Build an {@link MfaChallenge} from a caught sign-in error, or return `null`
 * when the error is not a second-factor challenge.
 *
 * This is deliberately total: it never throws. Callers invoke it from inside a
 * `catch` block, and a throw here would replace the original, more meaningful
 * sign-in error with an opaque one — the user would see a worse message than
 * the raw code they see today. Every unexpected shape (non-object errors,
 * Firebase not initialised, a resolver that comes back malformed) degrades to
 * `null` plus a warn breadcrumb, which the caller treats as "not an MFA error"
 * and surfaces through its existing error path.
 */
export function getMfaChallenge(err: unknown): MfaChallenge | null {
  if (getErrorCode(err) !== MFA_REQUIRED_CODE) return null;
  try {
    const resolver = getMultiFactorResolver(requireAuth(), err as MultiFactorError);
    if (!resolver || !Array.isArray(resolver.hints)) {
      logger.warn("mfa_challenge_malformed_resolver", { hasResolver: Boolean(resolver) });
      return null;
    }
    logger.info("mfa_challenge_detected", {
      factorCount: resolver.hints.length,
      factorIds: resolver.hints.map((h) => h.factorId),
    });
    return { resolver, hints: resolver.hints };
  } catch (resolverErr) {
    logger.warn("mfa_challenge_resolver_failed", {
      code: getErrorCode(resolverErr),
      message: parseFirebaseError(resolverErr),
    });
    return null;
  }
}

/**
 * Phone (SMS) second factor, step 1 — send the verification code and return
 * the `verificationId` that {@link completeSmsMfaSignIn} needs.
 *
 * A fresh invisible `RecaptchaVerifier` is created per attempt and cleared in a
 * `finally`. reCAPTCHA tokens are single-use: reusing a verifier makes the
 * second "resend code" attempt fail with `auth/invalid-app-credential`, and a
 * verifier left un-cleared keeps its widget mounted in the container so the
 * next render throws "reCAPTCHA has already been rendered in this element".
 * Clearing on the failure path matters as much as on success — a rejected send
 * (bad number, quota) is exactly when the user retries.
 *
 * Rejects with the underlying Firebase error so the caller can map codes such
 * as `auth/too-many-requests` to copy.
 */
export async function startSmsMfaSignIn(
  challenge: MfaChallenge,
  hint: MultiFactorInfo,
  container: HTMLElement | string,
): Promise<string> {
  const auth = requireAuth();
  const verifier = new RecaptchaVerifier(auth, container, { size: "invisible" });
  try {
    const provider = new PhoneAuthProvider(auth);
    const verificationId = await provider.verifyPhoneNumber(
      { multiFactorHint: hint, session: challenge.resolver.session },
      verifier,
    );
    // The hint's phone number is PII and is never logged — only the factor id.
    logger.info("mfa_sms_code_sent", { factorId: hint.factorId });
    return verificationId;
  } catch (err) {
    logger.warn("mfa_sms_code_send_failed", { code: getErrorCode(err), message: parseFirebaseError(err) });
    throw err;
  } finally {
    verifier.clear();
  }
}

/**
 * Phone (SMS) second factor, step 2 — exchange the user's code for a signed-in
 * session. Rejects with the Firebase error (`auth/invalid-verification-code`,
 * `auth/code-expired`, …) so the UI can map it; the typed code is never logged.
 */
export async function completeSmsMfaSignIn(
  challenge: MfaChallenge,
  verificationId: string,
  code: string,
): Promise<User> {
  try {
    const credential = PhoneAuthProvider.credential(verificationId, code);
    const assertion = PhoneMultiFactorGenerator.assertion(credential);
    const result = await challenge.resolver.resolveSignIn(assertion);
    logger.info("mfa_sign_in_resolved", { uid: result.user.uid, factorId: PhoneMultiFactorGenerator.FACTOR_ID });
    return result.user;
  } catch (err) {
    logger.warn("mfa_sms_sign_in_failed", { code: getErrorCode(err), message: parseFirebaseError(err) });
    throw err;
  }
}

/**
 * TOTP (authenticator app) second factor — single step, because the code is
 * generated on the user's device rather than sent by Firebase. The assertion is
 * bound to `hint.uid`, the enrolment id of the factor the user picked.
 *
 * Rejects with the Firebase error so the UI can map it; the code is not logged.
 */
export async function completeTotpMfaSignIn(
  challenge: MfaChallenge,
  hint: MultiFactorInfo,
  code: string,
): Promise<User> {
  try {
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
    const result = await challenge.resolver.resolveSignIn(assertion);
    logger.info("mfa_sign_in_resolved", { uid: result.user.uid, factorId: TotpMultiFactorGenerator.FACTOR_ID });
    return result.user;
  } catch (err) {
    logger.warn("mfa_totp_sign_in_failed", { code: getErrorCode(err), message: parseFirebaseError(err) });
    throw err;
  }
}

/** True when the hint is a phone (SMS) second factor. */
export function isPhoneHint(hint: MultiFactorInfo): boolean {
  return hint.factorId === PhoneMultiFactorGenerator.FACTOR_ID;
}

/** True when the hint is a TOTP (authenticator app) second factor. */
export function isTotpHint(hint: MultiFactorInfo): boolean {
  return hint.factorId === TotpMultiFactorGenerator.FACTOR_ID;
}

/** Masked phone number for a phone second-factor hint ("" when absent). Firebase pre-masks it (e.g. "+*******1234"); keeping the shape-read here keeps the SDK's types out of components. */
export function hintPhoneNumber(hint: MultiFactorInfo): string {
  // Only PhoneMultiFactorInfo carries `phoneNumber`; a TOTP hint has no such property.
  const { phoneNumber } = hint as Partial<PhoneMultiFactorInfo>;
  return typeof phoneNumber === "string" ? phoneNumber : "";
}
