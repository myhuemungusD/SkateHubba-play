import { useState, useEffect, useRef } from "react";
import { signUp, signIn, resetPassword, type SignUpResult } from "../services/auth";
import { EMAIL_RE, pwStrength, getErrorCode, parseFirebaseError, getUserMessage } from "../utils/helpers";
import { isMinorDob, parseDob } from "../utils/age";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { DobRow } from "../components/ui/DobRow";
import { GoogleButton } from "../components/GoogleButton";
import { CoppaBlockedCard } from "../components/CoppaBlockedCard";
import { logger, metrics } from "../services/logger";
import { analytics } from "../services/analytics";
import { captureException } from "../lib/sentry";
import { isBenignAuthCode, getAuthErrorMessage } from "../utils/authCodes";

export function AuthScreen({
  mode,
  onDone,
  onToggle,
  onGoogle,
  googleLoading,
  googleError,
  onGoogleErrorDismiss,
  showAgeFields = false,
  onAgeVerified,
  onNavLegal,
}: {
  mode: "signup" | "signin";
  onDone: () => void;
  onToggle: () => void;
  onGoogle: () => void;
  googleLoading: boolean;
  googleError: string;
  onGoogleErrorDismiss: () => void;
  /** Render DOB + parental-consent inputs inline in signup mode (COPPA/CCPA). */
  showAgeFields?: boolean;
  /** Called with the verified DOB string + consent flag BEFORE signUp runs. */
  onAgeVerified?: (dob: string, parentalConsent: boolean) => void;
  /** Navigate to the privacy/terms screen from inline consent links. */
  onNavLegal?: (screen: "privacy" | "terms") => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [parentConsent, setParentConsent] = useState(false);
  const [ageBlocked, setAgeBlocked] = useState(false);
  const [error, setError] = useState("");
  // Cleared alongside `error`; drives the inline recovery affordances below.
  const [lastErrorCode, setLastErrorCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [verifyWarning, setVerifyWarning] = useState(false);
  const isSignup = mode === "signup";
  const showDob = isSignup && showAgeFields;
  const anyLoading = loading || googleLoading;
  const isMinor = showDob && isMinorDob(month, day, year);

  // Reset one-shot UI state when the parent toggles mode, but preserve typed
  // email/password/DOB so the user doesn't have to retype. Skip on first mount
  // so a parent passing initial state isn't silently wiped.
  const didMount = useRef(false);
  useEffect(() => {
    if (!didMount.current) {
      didMount.current = true;
      return;
    }
    setError("");
    setLastErrorCode("");
    setResetSent(false);
    setVerifyWarning(false);
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
    if (!EMAIL_RE.test(email.trim())) {
      setError("Enter a valid email");
      return;
    }
    if (password.length < 6) {
      setError("Password must be 6+ characters");
      return;
    }
    if (isSignup && password !== confirm) {
      setError("Passwords don't match");
      return;
    }

    let verifiedDob: string | undefined;
    let verifiedConsent = false;
    if (showDob) {
      const result = parseDob(month, day, year);
      if (result.kind === "invalid") {
        setError(result.message);
        return;
      }
      if (result.kind === "blocked") {
        logger.info("age_gate_blocked", { age: result.age });
        setAgeBlocked(true);
        return;
      }
      if (result.needsParentalConsent && !parentConsent) {
        setError("Parental or guardian consent is required for users under 18");
        return;
      }
      verifiedDob = result.dobString;
      verifiedConsent = result.needsParentalConsent;
      logger.info("age_gate_passed_inline", { age: result.age, parentalConsent: verifiedConsent });
    }

    setLoading(true);
    const trimmedEmail = email.trim();
    logger.info("auth_screen_submit", { mode: isSignup ? "signup" : "signin", email: trimmedEmail });
    if (isSignup) {
      analytics.signUpAttempt("email");
      metrics.signUpAttempt("email");
    } else {
      analytics.signInAttempt("email");
      metrics.signInAttempt("email");
    }
    try {
      if (isSignup) {
        // Emit verified age data BEFORE the network call so ProfileSetup (which
        // mounts once auth state fires) can read it synchronously from context.
        if (verifiedDob) onAgeVerified?.(verifiedDob, verifiedConsent);
        const result: SignUpResult = await signUp(trimmedEmail, password);
        if (!result.verificationEmailSent) {
          setVerifyWarning(true);
        }
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
      if (isSignup) analytics.signUpFailure("email", code || "unknown");
      else analytics.signInFailure("email", code || "unknown");
      if (isSignup) metrics.signUpFailure("email", code || "unknown");
      else metrics.signInFailure("email", code || "unknown");
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
      if (code === "auth/email-already-in-use") {
        setError("Looks like you already have an account with this email.");
      } else if (code === "auth/user-not-found") {
        setError("No account with that email. Create one?");
      } else {
        setError(getAuthErrorMessage(code) ?? getUserMessage(err, "Something went wrong"));
      }
    } finally {
      setLoading(false);
    }
  };

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
  const recovery: { label: string; action: () => void } | null = (() => {
    if (isSignup && lastErrorCode === "auth/email-already-in-use") {
      return {
        label: "Sign in with this email instead →",
        action: () => {
          setError("");
          setLastErrorCode("");
          onToggle();
        },
      };
    }
    if (!isSignup && lastErrorCode === "auth/user-not-found") {
      return {
        label: "Create an account with this email →",
        action: () => {
          setError("");
          setLastErrorCode("");
          onToggle();
        },
      };
    }
    if (!isSignup && (lastErrorCode === "auth/invalid-credential" || lastErrorCode === "auth/wrong-password")) {
      return { label: "Forgot password? Send reset email →", action: handleReset };
    }
    return null;
  })();

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
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm p-8 rounded-2xl glass-card animate-scale-in">
        <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none mb-4" aria-hidden="true" />
        <h2 className="font-display text-fluid-3xl text-white mb-1">{isSignup ? "Create Account" : "Welcome Back"}</h2>
        <p className="font-body text-sm text-muted mb-7">
          {isSignup
            ? showDob
              ? "Join the crew. It's free. We collect your DOB to comply with COPPA & CCPA."
              : "Join the crew. It's free."
            : "Sign in to continue your games."}
        </p>

        <GoogleButton onClick={onGoogle} loading={googleLoading} />

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
          aria-busy={googleLoading || undefined}
          className={`transition-opacity duration-200 ${googleLoading ? "opacity-40 pointer-events-none" : ""}`}
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
          <Field
            label="Password"
            name="password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            icon="🔒"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            enterKeyHint={isSignup ? "next" : "go"}
          />
          {isSignup &&
            password.length > 0 &&
            (() => {
              const strength = pwStrength(password);
              const labels: Record<1 | 2 | 3, string> = { 1: "Weak", 2: "Fair", 3: "Strong" };
              const colors: Record<1 | 2 | 3, string> = {
                1: "bg-brand-red",
                2: "bg-yellow-500",
                3: "bg-brand-green",
              };
              return (
                <div
                  className="flex items-center gap-2 -mt-2 mb-4"
                  role="status"
                  aria-label={`Password strength: ${labels[strength]}`}
                >
                  <div className="flex gap-1 flex-1" aria-hidden="true">
                    {([1, 2, 3] as const).map((lvl) => (
                      <div
                        key={lvl}
                        className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
                          strength >= lvl ? colors[strength] : "bg-surface-alt"
                        }`}
                      />
                    ))}
                  </div>
                  <span className={`font-body text-[10px] ${colors[strength].replace("bg-", "text-")}`}>
                    {labels[strength]}
                  </span>
                </div>
              );
            })()}
          {isSignup && (
            <Field
              label="Confirm"
              name="confirm-password"
              value={confirm}
              onChange={setConfirm}
              placeholder="••••••••"
              icon="🔒"
              type="password"
              autoComplete="new-password"
              enterKeyHint={showDob ? "next" : "go"}
            />
          )}

          {showDob && (
            <>
              <label className="block font-display text-sm tracking-[0.12em] text-dim mb-2">Date of Birth</label>
              <DobRow month={month} day={day} year={year} onChange={updateDob} disabled={anyLoading} />
              <p className="font-body text-xs text-subtle mb-5">
                Your date of birth is used only for age verification and is never shared.
              </p>
              {isMinor && (
                <label className="flex items-start gap-3 mb-5 cursor-pointer group">
                  <input
                    type="checkbox"
                    checked={parentConsent}
                    onChange={(e) => setParentConsent(e.target.checked)}
                    className="mt-0.5 w-4 h-4 accent-brand-orange cursor-pointer shrink-0"
                    aria-label="Parental consent"
                  />
                  <span className="font-body text-sm text-dim leading-relaxed group-hover:text-bright transition-colors">
                    My parent or legal guardian has reviewed the{" "}
                    <button
                      type="button"
                      onClick={() => onNavLegal?.("privacy")}
                      className="text-brand-orange hover:underline"
                    >
                      Privacy Policy
                    </button>{" "}
                    and{" "}
                    <button
                      type="button"
                      onClick={() => onNavLegal?.("terms")}
                      className="text-brand-orange hover:underline"
                    >
                      Terms of Service
                    </button>{" "}
                    and consents to my use of SkateHubba.
                  </span>
                </label>
              )}
            </>
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
              className="w-full -mt-2 mb-4 px-4 py-2 rounded-xl font-body text-sm text-brand-orange bg-brand-orange/[0.08] border border-brand-orange/30 hover:bg-brand-orange/[0.14] transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              {recovery.label}
            </button>
          )}

          {verifyWarning && (
            <div className="w-full p-3 rounded-xl bg-[rgba(255,168,0,0.08)] border border-yellow-500/40 mb-4">
              <span className="font-body text-sm text-yellow-400">
                Account created but the verification email failed to send. Use the Resend button on the next screen.
              </span>
            </div>
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

        {!isSignup && !googleLoading && (
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
