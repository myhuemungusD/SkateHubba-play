/**
 * Copy and session handoff for Firebase email-verification sends.
 *
 * `sendEmailVerification` resolving means Identity Toolkit accepted the
 * request. It does not mean a mailbox received anything. The banner and the
 * signup toast share these sentences so a failed send never reads as
 * "check your inbox".
 */

const VERIFICATION_ERROR_CODES = [
  "auth/too-many-requests",
  "auth/quota-exceeded",
  "auth/unauthorized-continue-uri",
  "auth/invalid-continue-uri",
  "auth/network-request-failed",
  "auth/firebase-app-check-token-is-invalid",
  "auth/invalid-app-credential",
  "auth/no-current-user",
] as const;

type KnownVerificationCode = (typeof VERIFICATION_ERROR_CODES)[number];

/** Shown after Identity Toolkit accepts a send. Not a delivery receipt. */
export const VERIFICATION_ACCEPTED_COPY =
  "Firebase accepted the verification email. Check inbox and spam. Acceptance is not delivery — use Resend if it never arrives.";

/** Shown when this session has not confirmed a send. */
export const VERIFICATION_UNVERIFIED_COPY =
  "Your email is not verified yet. If the link is not in your inbox or spam, use Resend.";

/** sessionStorage key. Signup writes it; the banner reads it after the screen swap. */
export const VERIFICATION_SEND_STATE_KEY = "skatehubba_verification_send_state";

export type VerificationSendState = { status: "accepted" } | { status: "failed"; code: string };

function isKnownVerificationCode(code: string): code is KnownVerificationCode {
  return (VERIFICATION_ERROR_CODES as readonly string[]).includes(code);
}

function messageForKnownCode(code: KnownVerificationCode): string {
  switch (code) {
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
      return "Firebase is limiting verification emails right now. Wait five minutes, then use Resend.";
    case "auth/unauthorized-continue-uri":
    case "auth/invalid-continue-uri":
      return "Firebase rejected the return address on the verification link. Use Resend. This site has to be listed under Authentication → Settings → Authorized domains.";
    case "auth/network-request-failed":
      return "The verification email did not send — the request never reached Firebase. Use Resend when you are back online.";
    case "auth/firebase-app-check-token-is-invalid":
    case "auth/invalid-app-credential":
      return "Firebase blocked the verification email before it was sent (App Check). Use Resend. If this keeps happening, check Identity Toolkit App Check enforcement.";
    case "auth/no-current-user":
      return "You are not signed in, so no verification email was sent.";
    default: {
      const unreachable: never = code;
      return unreachable;
    }
  }
}

/** User-facing sentence for a failed `sendEmailVerification`. Includes unknown codes. */
export function verificationFailureMessage(code: string): string {
  if (isKnownVerificationCode(code)) return messageForKnownCode(code);
  if (code) return `The verification email was not accepted (${code}). Use Resend.`;
  return "The verification email was not accepted. Use Resend. No error code came back.";
}

/** True for the two Identity Toolkit codes that need the long cooldown. */
export function isVerificationRateLimit(code: string): boolean {
  return code === "auth/too-many-requests" || code === "auth/quota-exceeded";
}

/** Host of the continue URL we hand to Firebase. Empty when it is not a URL. */
export function verificationContinueHost(): string {
  const fromEnv = import.meta.env.VITE_APP_URL;
  const raw = (typeof fromEnv === "string" && fromEnv) || (typeof window !== "undefined" ? window.location.origin : "");
  if (!raw) return "";
  try {
    return new URL(raw).host;
  } catch {
    return "";
  }
}

export function readVerificationSendState(): VerificationSendState | null {
  try {
    const raw = sessionStorage.getItem(VERIFICATION_SEND_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const status = (parsed as { status?: unknown }).status;
    if (status === "accepted") return { status: "accepted" };
    if (status === "failed") {
      const code = (parsed as { code?: unknown }).code;
      return { status: "failed", code: typeof code === "string" ? code : "" };
    }
    return null;
  } catch {
    return null;
  }
}

export function writeVerificationSendState(state: VerificationSendState): void {
  try {
    sessionStorage.setItem(VERIFICATION_SEND_STATE_KEY, JSON.stringify(state));
  } catch {
    /* sessionStorage unavailable — the toast still carries the failure */
  }
}
