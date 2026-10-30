import type { SignUpResult } from "../services/auth";
import type { NotifyOpts } from "../context/NotificationContext";
import { verificationFailureMessage, writeVerificationSendState } from "../utils/verificationEmail";
import { analytics } from "../services/analytics";
import { logger, metrics } from "../services/logger";
import { EMAIL_RE, getUserMessage, parseFirebaseError } from "../utils/helpers";
import { passwordPolicyMessage, type SignupPasswordPolicy } from "../utils/passwordPolicy";
import { getAuthErrorMessage, isBenignAuthCode } from "../utils/authCodes";
import { captureException } from "../lib/sentry";
import { parseDob } from "../utils/age";
import { isAgeGateBlocked, markAgeGateBlocked } from "../utils/coppaNotice";

/** Client-side email/password checks for AuthScreen. Returns the banner copy, or null when valid. */
export function validateCredentials({
  email,
  password,
  confirm,
  isSignup,
  policy,
}: {
  email: string;
  password: string;
  confirm: string;
  isSignup: boolean;
  policy: SignupPasswordPolicy;
}): string | null {
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email";
  if (isSignup) {
    const policyError = passwordPolicyMessage(password, policy);
    if (policyError) return policyError;
  } else if (password.length === 0) {
    return "Please fill in both email and password.";
  }
  if (isSignup && password !== confirm) return "Passwords don't match";
  return null;
}

export function trackEmailAuthAttempt(isSignup: boolean): void {
  if (isSignup) {
    analytics.signUpAttempt("email");
    metrics.signUpAttempt("email");
  } else {
    analytics.signInAttempt("email");
    metrics.signInAttempt("email");
  }
}

function trackEmailAuthFailure(isSignup: boolean, code: string): void {
  if (isSignup) analytics.signUpFailure("email", code || "unknown");
  else analytics.signInFailure("email", code || "unknown");
  if (isSignup) metrics.signUpFailure("email", code || "unknown");
  else metrics.signInFailure("email", code || "unknown");
}

/**
 * Log + count a failed email submit, and forward it to Sentry unless the code
 * is benign (wrong password, email taken, popup closed): user-error noise
 * would drown real outage signals. Not called for a pending second factor.
 */
export function reportEmailAuthFailure(isSignup: boolean, code: string, err: unknown): void {
  trackEmailAuthFailure(isSignup, code);
  if (!isBenignAuthCode(code)) {
    captureException(err, {
      extra: { context: "AuthScreen.submit", mode: isSignup ? "signup" : "signin", code },
    });
  }
}

/** Structured warn line for every failed email submit, MFA included. */
export function logEmailAuthError(isSignup: boolean, code: string, err: unknown): void {
  logger.warn("auth_screen_submit_error", {
    mode: isSignup ? "signup" : "signin",
    code,
    message: parseFirebaseError(err),
  });
}

/**
 * Banner copy for a failed email submit. Context-sensitive cases first —
 * these pair with an inline recovery action the generic mapper can't express.
 */
export function emailAuthErrorMessage(code: string, err: unknown): string {
  if (code === "auth/email-already-in-use") return "Looks like you already have an account with this email.";
  if (code === "auth/user-not-found") return "No account with that email. Create one?";
  return getAuthErrorMessage(code) ?? getUserMessage(err, "Something went wrong");
}

export interface AuthRecovery {
  label: string;
  action: () => void;
}

/**
 * Single source of truth for the inline recovery button rendered under the
 * ErrorBanner. Prevents two buttons stacking and keeps the action paired
 * with the exact error code that surfaced.
 */
export function authRecovery(
  isSignup: boolean,
  lastErrorCode: string,
  switchMode: () => void,
  sendReset: () => void,
): AuthRecovery | null {
  if (isSignup && lastErrorCode === "auth/email-already-in-use") {
    return { label: "Sign in with this email instead →", action: switchMode };
  }
  if (!isSignup && lastErrorCode === "auth/user-not-found") {
    return { label: "Create an account with this email →", action: switchMode };
  }
  if (!isSignup && (lastErrorCode === "auth/invalid-credential" || lastErrorCode === "auth/wrong-password")) {
    return { label: "Forgot password? Send reset email →", action: sendReset };
  }
  return null;
}

export type InlineDobGate =
  { kind: "error"; message: string } | { kind: "blocked" } | { kind: "ok"; dob: string; parentalConsent: boolean };

/**
 * Validate an inline signup DOB + consent (COPPA/CCPA), logging the outcome.
 * Shared by email signup (AuthScreen) and Google/Apple signup (ProfileSetup).
 *
 * A block is sticky for 24 hours on this device (utils/coppaNotice), so going
 * back and typing an older date still blocks. Logs never carry the age.
 */
export function checkInlineDob(
  month: string,
  day: string,
  year: string,
  parentConsent: boolean,
  source: "email_signup" | "profile_setup",
): InlineDobGate {
  if (isAgeGateBlocked()) {
    logger.info("age_gate_blocked", { source, sticky: true });
    return { kind: "blocked" };
  }
  const result = parseDob(month, day, year);
  if (result.kind === "invalid") return { kind: "error", message: result.message };
  if (result.kind === "blocked") {
    markAgeGateBlocked();
    logger.info("age_gate_blocked", { source });
    return { kind: "blocked" };
  }
  if (result.needsParentalConsent && !parentConsent) {
    return { kind: "error", message: "Parental or guardian consent is required for users under 18" };
  }
  logger.info("age_gate_passed_inline", { source, parentalConsent: result.needsParentalConsent });
  return { kind: "ok", dob: result.dobString, parentalConsent: result.needsParentalConsent };
}

/**
 * Record the verification-send outcome after signUp. A failure fires a toast
 * rather than inline banner state — onDone() triggers a screen swap almost
 * immediately, so any local banner would render for at most a frame. The
 * toast persists in NotificationProvider state across the unmount and
 * surfaces on the destination screen (usually ProfileSetup or Lobby). The
 * session flag is what the verify banner reads so it does not claim a mail
 * is waiting when this send was rejected.
 */
export function reportVerificationSend(result: SignUpResult, notify: (opts: NotifyOpts) => void): void {
  if (!result.verificationEmailSent) {
    const code = result.verificationErrorCode ?? "";
    writeVerificationSendState({ status: "failed", code });
    notify({
      type: "error",
      title: result.throttled ? "Verification email delayed" : "Verification email failed",
      message: verificationFailureMessage(code),
    });
  } else {
    writeVerificationSendState({ status: "accepted" });
  }
}
