import { useCallback, useEffect, useRef, useState } from "react";
import {
  completeSmsMfaSignIn,
  completeTotpMfaSignIn,
  hintPhoneNumber,
  isPhoneHint,
  isTotpHint,
  startSmsMfaSignIn,
  type MfaChallenge,
} from "../services/mfa";
import { Btn } from "./ui/Btn";
import { Field } from "./ui/Field";
import { ErrorBanner } from "./ui/ErrorBanner";
import { logger } from "../services/logger";
import { getErrorCode } from "../utils/helpers";
import { getAuthErrorMessage } from "../utils/authCodes";

/** One enrolled second factor, derived from the challenge so this component
 *  never has to import the Firebase SDK for its types. */
type MfaHint = MfaChallenge["hints"][number];

/**
 * How long after a successful send before the resend affordance appears. The
 * SMS that never arrives is the failure mode the user cannot report, so the
 * button has to exist without them first having to submit a wrong code — but
 * not instantly, or an impatient tap burns their carrier rate limit.
 */
const RESEND_COOLDOWN_MS = 30_000;

function hintLabel(hint: MfaHint): string {
  if (hint.displayName) return hint.displayName;
  if (isTotpHint(hint)) return "Authenticator app";
  return hintPhoneNumber(hint) || "Second factor";
}

/**
 * Map a second-factor failure to copy. Every mapped code lives in the shared
 * mapper so the wording matches the rest of the auth surface — this only owns
 * the fallback for codes nothing has claimed.
 */
function mfaErrorMessage(code: string): string {
  return getAuthErrorMessage(code) ?? "Verification failed. Please try again.";
}

/**
 * Second-factor challenge card. Rendered in place of the sign-in form once a
 * sign-in attempt comes back with a pending MFA challenge — the credential was
 * accepted, Firebase is just holding the session until the extra step clears.
 *
 * The parent owns the challenge lifetime: `onCancel` drops it (back to the
 * form), `onDone` fires once Firebase has signed the user in, at which point
 * the auth-state change drives navigation.
 */
export function MfaVerifyCard({
  challenge,
  onDone,
  onCancel,
}: {
  challenge: MfaChallenge;
  onDone: () => void;
  onCancel: () => void;
}) {
  const hints = challenge.hints;
  // Auto-select the only factor so the common case skips the picker entirely.
  const [hint, setHint] = useState<MfaHint | null>(hints.length === 1 ? hints[0] : null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [canResend, setCanResend] = useState(false);
  const [verificationId, setVerificationId] = useState("");
  const recaptchaRef = useRef<HTMLDivElement>(null);
  // Which factor we've already auto-sent an SMS for. Without this the effect
  // re-fires (StrictMode double-invoke, re-render after setState) and burns a
  // second SMS against the user's rate limit.
  const autoSentFor = useRef<string | null>(null);
  const resendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drop a pending cooldown on unmount so it can't setState on a dead card.
  useEffect(() => () => (resendTimer.current ? clearTimeout(resendTimer.current) : undefined), []);

  const sendSmsCode = useCallback(
    async (target: MfaHint) => {
      const container = recaptchaRef.current;
      /* v8 ignore next -- ref is populated on mount; guard is for type-narrowing only */
      if (!container) return;
      setSending(true);
      setError("");
      setCanResend(false);
      if (resendTimer.current) clearTimeout(resendTimer.current);
      try {
        setVerificationId(await startSmsMfaSignIn(challenge, target, container));
        // Sent — but an SMS can still silently never arrive, so re-offer the
        // resend once the cooldown lapses.
        resendTimer.current = setTimeout(() => setCanResend(true), RESEND_COOLDOWN_MS);
      } catch (err) {
        const code = getErrorCode(err);
        logger.warn("mfa_ui_send_failed", { code });
        setError(mfaErrorMessage(code));
        setCanResend(true);
      } finally {
        setSending(false);
      }
    },
    [challenge],
  );

  useEffect(() => {
    if (!hint || !isPhoneHint(hint)) return;
    if (autoSentFor.current === hint.uid) return;
    autoSentFor.current = hint.uid;
    void sendSmsCode(hint);
  }, [hint, sendSmsCode]);

  const verify = async () => {
    /* v8 ignore next -- the form only renders once a hint is selected */
    if (!hint) return;
    const typed = code.trim();
    if (!typed) {
      setError("Enter the code to continue.");
      return;
    }
    // No verificationId means the initial send never landed (quota, bad
    // number). Handing "" to the SDK only buys an unmapped
    // auth/missing-verification-id, so stop here and point at the resend.
    if (!isTotpHint(hint) && !verificationId) {
      logger.warn("mfa_ui_verify_no_verification_id", { factorId: hint.factorId });
      setError("Request a new code first.");
      if (isPhoneHint(hint)) setCanResend(true);
      return;
    }
    setVerifying(true);
    setError("");
    try {
      if (isTotpHint(hint)) await completeTotpMfaSignIn(challenge, hint, typed);
      else await completeSmsMfaSignIn(challenge, verificationId, typed);
      logger.info("mfa_ui_resolved", { factorId: hint.factorId });
      onDone();
    } catch (err) {
      // The typed code is never logged — only the resulting Firebase code.
      const failCode = getErrorCode(err);
      logger.warn("mfa_ui_verify_failed", { code: failCode, factorId: hint.factorId });
      setError(mfaErrorMessage(failCode));
      if (isPhoneHint(hint)) setCanResend(true);
    } finally {
      setVerifying(false);
    }
  };

  // Firebase hands the enrolled phone back already masked (e.g. "+1 •••••1234"),
  // so it is safe to render — but it is still PII and is never logged.
  const phone = hint ? hintPhoneNumber(hint) : "";
  const prompt = !hint
    ? "Choose how you want to verify."
    : isTotpHint(hint)
      ? "Enter the 6-digit code from your authenticator app."
      : phone
        ? `Enter the 6-digit code sent to ${phone}.`
        : "Enter the 6-digit code we sent you.";

  const backButton = (
    <button
      type="button"
      onClick={onCancel}
      className="w-full touch-target font-body text-sm text-dim text-center mt-3 cursor-pointer bg-transparent border-none transition-colors duration-300 hover:text-white rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
    >
      Back to sign in
    </button>
  );

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm p-8 rounded-2xl glass-card animate-scale-in">
        <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none mb-4" aria-hidden="true" />
        <h2 className="font-display text-fluid-3xl text-white mb-1">Two-Step Verification</h2>
        <p className="font-body text-sm text-muted mb-7">{prompt}</p>

        {/* Host element for the invisible reCAPTCHA the SMS factor needs. It
            must exist before startSmsMfaSignIn runs, so it stays mounted for
            every factor type. */}
        <div ref={recaptchaRef} className="hidden" aria-hidden="true" />

        {hint ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              verify();
            }}
            noValidate
          >
            <Field
              label="Verification code"
              name="one-time-code"
              value={code}
              onChange={setCode}
              placeholder="123456"
              icon="🔐"
              maxLength={6}
              autoComplete="one-time-code"
              inputMode="numeric"
              enterKeyHint="go"
              disabled={verifying}
            />

            <ErrorBanner message={error} onDismiss={() => setError("")} />

            {canResend && isPhoneHint(hint) && (
              <button
                type="button"
                onClick={() => void sendSmsCode(hint)}
                disabled={sending}
                className="w-full -mt-2 mb-4 px-4 py-2 min-h-[44px] rounded-xl font-body text-sm text-brand-orange bg-brand-orange/[0.08] border border-brand-orange/30 hover:bg-brand-orange/[0.14] transition-colors duration-200 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              >
                {sending ? "Sending…" : "Resend code"}
              </button>
            )}

            <Btn type="submit" disabled={verifying || sending}>
              {verifying ? (
                <span className="inline-flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verifying…
                </span>
              ) : (
                "Verify"
              )}
            </Btn>
          </form>
        ) : (
          <div className="flex flex-col gap-3">
            {hints.map((h) => (
              <Btn key={h.uid} variant="secondary" onClick={() => setHint(h)}>
                {hintLabel(h)}
              </Btn>
            ))}
          </div>
        )}

        {backButton}
      </div>
    </div>
  );
}
