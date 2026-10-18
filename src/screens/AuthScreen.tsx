import { useState, useEffect, useRef } from "react";
import { ChevronLeft } from "lucide-react";
import { signUp, signIn, resetPassword, type SignUpResult } from "../services/auth";
import { loadSignupPasswordPolicy } from "../services/passwordPolicy";
import { EMAIL_RE, getErrorCode, parseFirebaseError } from "../utils/helpers";
import { MIRRORED_PASSWORD_POLICY, type SignupPasswordPolicy } from "../utils/passwordPolicy";
import { isMinorDob } from "../utils/age";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { DobConsentFields } from "../components/DobConsentFields";
import { AppleButton } from "../components/AppleButton";
import { GoogleButton } from "../components/GoogleButton";
import { CoppaBlockedCard } from "../components/CoppaBlockedCard";
import { MfaVerifyCard } from "../components/MfaVerifyCard";
import type { MfaChallenge } from "../services/mfa";
import type { MfaMethod } from "../context/AuthContext";
import { logger, metrics } from "../services/logger";
import { analytics } from "../services/analytics";
import { AuthPasswordFields } from "./AuthPasswordFields";
import {
  authRecovery,
  checkInlineDob,
  reportVerificationSend,
  emailAuthErrorMessage,
  trackEmailAuthAttempt,
  trackEmailAuthFailure,
  validateCredentials,
} from "./authScreenHelpers";
import { captureException } from "../lib/sentry";
import { isBenignAuthCode } from "../utils/authCodes";
import { useNotifications } from "../context/NotificationContext";
import { isAppleSignInEnabled } from "../lib/featureFlags";
import { clearBootAuthDraft, peekBootAuthDraft } from "../boot/landingBoot";

export function AuthScreen({
  mode,
  onDone,
  onToggle,
  onGoogle,
  googleLoading,
  onApple,
  appleLoading,
  googleError,
  onGoogleErrorDismiss,
  mfaChallenge,
  onMfaBegin,
  onMfaCancel,
  showAgeFields = false,
  onAgeVerified,
  onAgeGateReset,
  onNavLegal,
  onBack,
}: {
  mode: "signup" | "signin";
  onDone: () => void;
  onToggle: () => void;
  onGoogle: () => void;
  googleLoading: boolean;
  onApple: () => void;
  appleLoading: boolean;
  googleError: string;
  onGoogleErrorDismiss: () => void;
  /** Pending second-factor challenge (from either sign-in path). While set,
   *  the form is replaced by the verification card. */
  mfaChallenge: MfaChallenge | null;
  /** Hand a caught sign-in error to the MFA flow, tagged with the sign-in
   *  method so the deferred success event is attributed correctly. Returns true
   *  when it was a second-factor challenge and this screen should stop its
   *  error handling. */
  onMfaBegin: (err: unknown, method: MfaMethod) => boolean;
  /** Abandon the pending challenge and return to the form. */
  onMfaCancel: () => void;
  /** Render DOB + parental-consent inputs inline in signup mode (COPPA/CCPA). */
  showAgeFields?: boolean;
  /** Called with the verified DOB string + consent flag BEFORE signUp runs. */
  onAgeVerified?: (dob: string, parentalConsent: boolean) => void;
  /** Called after a signUp rejection to roll back the age-gate context that
   *  `onAgeVerified` optimistically wrote BEFORE the network call. Without
   *  this the DOB leaks across the failed-signup boundary and pollutes a
   *  subsequent sign-in with an existing account. */
  onAgeGateReset?: () => void;
  /** Header Back (to the landing page when opened cold). Without it /auth was a dead end in the native app. */
  onBack?: () => void;
  /** Navigate to the privacy/terms screen from inline consent links. */
  onNavLegal?: (screen: "privacy" | "terms") => void;
}) {
  const bootDraft = peekBootAuthDraft();
  const [email, setEmail] = useState(bootDraft.email);
  const [password, setPassword] = useState(bootDraft.password);
  const [confirm, setConfirm] = useState(bootDraft.confirm);
  const [month, setMonth] = useState(bootDraft.month);
  const [day, setDay] = useState(bootDraft.day);
  const [year, setYear] = useState(bootDraft.year);
  const [parentConsent, setParentConsent] = useState(bootDraft.parentConsent);
  const [ageBlocked, setAgeBlocked] = useState(false);
  const [error, setError] = useState("");
  // Cleared alongside `error`; drives the inline recovery affordances below.
  const [lastErrorCode, setLastErrorCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const { notify } = useNotifications();
  const isSignup = mode === "signup";
  const showDob = isSignup && showAgeFields;
  const appleOn = isAppleSignInEnabled();
  const socialLoading = googleLoading || (appleOn && appleLoading);
  const anyLoading = loading || socialLoading;
  const isMinor = showDob && isMinorDob(month, day, year);

  // Reset one-shot UI state when the parent toggles mode, but preserve typed
  // email/password/DOB so the user doesn't have to retype. Skip on first mount
  // so a parent passing initial state isn't silently wiped.
  const [passwordPolicy, setPasswordPolicy] = useState<SignupPasswordPolicy>(MIRRORED_PASSWORD_POLICY);
  useEffect(() => {
    let live = true;
    void loadSignupPasswordPolicy().then((next) => {
      if (live) setPasswordPolicy(next);
    });
    return () => {
      live = false;
    };
  }, []);

  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    setError("");
    setLastErrorCode("");
    setResetSent(false);
    setAgeBlocked(false);
  }, [mode]);

  const updateDob = (field: "month" | "day" | "year", value: string) => {
    if (field === "month") setMonth(value);
    else if (field === "day") setDay(value);
    else setYear(value);
  };

  const submit = async () => {
    setError("");
    setLastErrorCode("");
    const credentialError = validateCredentials({ email, password, confirm, isSignup, policy: passwordPolicy });
    if (credentialError) {
      setError(credentialError);
      return;
    }

    let verifiedDob: string | undefined;
    let verifiedConsent = false;
    if (showDob) {
      const gate = checkInlineDob(month, day, year, parentConsent);
      if (gate.kind === "error") {
        setError(gate.message);
        return;
      }
      if (gate.kind === "blocked") {
        setAgeBlocked(true);
        return;
      }
      verifiedDob = gate.dob;
      verifiedConsent = gate.parentalConsent;
    }

    setLoading(true);
    const trimmedEmail = email.trim();
    logger.info("auth_screen_submit", { mode: isSignup ? "signup" : "signin", email: trimmedEmail });
    trackEmailAuthAttempt(isSignup);
    try {
      if (isSignup) {
        // Emit verified age data BEFORE the network call so ProfileSetup (which
        // mounts once auth state fires) can read it synchronously from context.
        if (verifiedDob) onAgeVerified?.(verifiedDob, verifiedConsent);
        const result: SignUpResult = await signUp(trimmedEmail, password);
        reportVerificationSend(result, notify);
        analytics.signUp("email");
        metrics.signUp("email", result.user.uid);
      } else {
        const user = await signIn(trimmedEmail, password);
        analytics.signIn("email");
        metrics.signIn("email", user.uid);
      }
      logger.info("auth_screen_submit_success", { mode: isSignup ? "signup" : "signin" });
      onDone();
    } catch (err: unknown) {
      const code = getErrorCode(err);
      logger.warn("auth_screen_submit_error", {
        mode: isSignup ? "signup" : "signin",
        code,
        message: parseFirebaseError(err),
      });
      // Roll back the optimistic age-gate context write we made before the
      // network call. Otherwise the DOB persists past the failed signup and
      // pollutes a subsequent sign-in with a different (existing) account.
      if (isSignup && verifiedDob) onAgeGateReset?.();
      // Second factor pending: the password was correct, so there is nothing to
      // surface in the banner, nothing for Sentry, and — critically — no
      // failure to record. Counting the challenge as a sign-in failure made MFA
      // adoption read as a rising failure rate; the matching `sign_in` is
      // emitted by AuthContext once the challenge clears. The card takes over.
      if (onMfaBegin(err, "email")) return;
      trackEmailAuthFailure(isSignup, code);
      // Only surface non-benign codes to Sentry as exceptions — benign codes
      // (wrong password, email taken, popup closed) would drown real outage
      // signals in user-error noise.
      if (!isBenignAuthCode(code)) {
        captureException(err, {
          extra: { context: "AuthScreen.submit", mode: isSignup ? "signup" : "signin", code },
        });
      }
      setLastErrorCode(code);
      // Context-sensitive cases first — these pair with an inline recovery
      // action below that the generic mapper can't express.
      setError(emailAuthErrorMessage(code, err));
    } finally {
      setLoading(false);
    }
  };

  // Drop the boot-shell draft once this screen owns the fields. State was
  // already seeded from it; StrictMode reuses that state.
  useEffect(() => {
    clearBootAuthDraft();
  }, []);

  const handleReset = async () => {
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter your email first");
      return;
    }
    logger.info("auth_screen_password_reset", { email: email.trim() });
    // Clear the prior credential failure so the inline "Forgot password?"
    // recovery button collapses now that we've acted on it.
    setError("");
    setLastErrorCode("");
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (err) {
      logger.warn("auth_screen_password_reset_error", { error: parseFirebaseError(err) });
      setResetSent(true); // Don't reveal if email exists
    }
  };

  const displayError = error || googleError;

  // Single source of truth for the inline recovery button rendered under the
  // ErrorBanner. Prevents two buttons stacking and keeps the action paired
  // with the exact error code that surfaced.
  const recovery = authRecovery(
    isSignup,
    lastErrorCode,
    () => {
      setError("");
      setLastErrorCode("");
      onToggle();
    },
    handleReset,
  );

  if (mfaChallenge) {
    return <MfaVerifyCard challenge={mfaChallenge} onDone={onDone} onCancel={onMfaCancel} />;
  }

  if (ageBlocked) {
    return (
      <CoppaBlockedCard
        onBack={() => {
          // Clear the failing DOB so the form doesn't re-block immediately on
          // next submit (it held the values that triggered the block).
          setMonth("");
          setDay("");
          setYear("");
          setParentConsent(false);
          setAgeBlocked(false);
        }}
      />
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center px-6 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[calc(var(--consent-banner-space,0px)+1.25rem)]">
      {onBack && (
        <div className="w-full max-w-sm">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            data-testid="screen-back"
            className="-ml-2 inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-brand-orange"
          >
            <ChevronLeft size={26} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="my-auto w-full max-w-sm p-6 sm:p-8 rounded-2xl glass-card animate-scale-in">
        <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none mb-4" aria-hidden="true" />
        <h2 className="font-display text-fluid-3xl text-white mb-1">{isSignup ? "Create Account" : "Welcome Back"}</h2>
        <p className="font-body text-sm text-muted mb-5 sm:mb-7">
          {isSignup
            ? showDob
              ? "Join the crew. It's free. We collect your DOB to comply with COPPA & CCPA."
              : "Join the crew. It's free."
            : "Sign in to continue your games."}
        </p>

        <div className="flex flex-col gap-3">
          {appleOn ? <AppleButton onClick={onApple} loading={appleLoading} disabled={googleLoading} /> : null}
          <GoogleButton onClick={onGoogle} loading={googleLoading} disabled={appleOn && appleLoading} />
        </div>

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <span className="font-body text-xs text-subtle">or continue with email</span>
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
          aria-busy={socialLoading || undefined}
          className={`transition-opacity duration-200 ${socialLoading ? "opacity-40 pointer-events-none" : ""}`}
        >
          <Field
            label="Email"
            name="email"
            value={email}
            onChange={setEmail}
            placeholder="you@email.com"
            icon="@"
            type="email"
            autoComplete="email"
            inputMode="email"
            enterKeyHint="next"
          />
          <AuthPasswordFields
            isSignup={isSignup}
            showDob={showDob}
            password={password}
            setPassword={setPassword}
            confirm={confirm}
            setConfirm={setConfirm}
            policy={passwordPolicy}
          />

          {showDob && (
            <DobConsentFields
              month={month}
              day={day}
              year={year}
              onDobChange={updateDob}
              disabled={anyLoading}
              helpText="Your date of birth is used only for age verification and is never shared."
              showConsent={isMinor}
              consent={parentConsent}
              onConsentChange={setParentConsent}
              onNavLegal={onNavLegal}
            />
          )}

          <ErrorBanner
            message={displayError}
            onDismiss={() => {
              setError("");
              setLastErrorCode("");
              onGoogleErrorDismiss();
            }}
          />

          {recovery && (
            <button
              type="button"
              onClick={recovery.action}
              className="w-full -mt-2 mb-4 px-4 py-2 min-h-[44px] rounded-xl font-body text-sm text-brand-orange bg-brand-orange/[0.08] border border-brand-orange/30 hover:bg-brand-orange/[0.14] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              {recovery.label}
            </button>
          )}

          {resetSent && (
            <div className="w-full p-3 rounded-xl bg-[rgba(0,230,118,0.08)] border border-brand-green mb-4">
              <span className="font-body text-sm text-brand-green">Reset email sent (if account exists)</span>
            </div>
          )}

          <Btn type="submit" disabled={anyLoading}>
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {isSignup ? "Creating Account…" : "Signing In…"}
              </span>
            ) : isSignup ? (
              "Create Account"
            ) : (
              "Sign In"
            )}
          </Btn>
        </form>

        {!isSignup && !socialLoading && (
          <button
            type="button"
            className="w-full touch-target font-body text-xs text-subtle text-center mt-1 cursor-pointer hover:text-white transition-colors duration-300 bg-transparent border-none rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            onClick={handleReset}
          >
            Forgot password?
          </button>
        )}

        <button
          type="button"
          className="w-full touch-target font-body text-sm text-dim text-center mt-3 cursor-pointer bg-transparent border-none transition-colors duration-300 hover:text-white rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          onClick={onToggle}
        >
          {isSignup ? "Already have an account? " : "Need an account? "}
          <span className="text-brand-orange font-semibold hover:underline underline-offset-2">
            {isSignup ? "Sign in" : "Sign up"}
          </span>
        </button>
      </div>
    </div>
  );
}
