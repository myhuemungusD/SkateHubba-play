import { useState } from "react";
import { signUp, signIn, resetPassword, type SignUpResult } from "../services/auth";
import { EMAIL_RE, pwStrength, getErrorCode, parseFirebaseError, getUserMessage } from "../utils/helpers";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { GoogleButton } from "../components/GoogleButton";
import { logger } from "../services/logger";

export function AuthScreen({
  mode,
  onDone,
  onToggle,
  onGoogle,
  googleLoading,
  googleError,
  onGoogleErrorDismiss,
}: {
  mode: "signup" | "signin";
  onDone: () => void;
  onToggle: () => void;
  onGoogle: () => void;
  googleLoading: boolean;
  googleError: string;
  onGoogleErrorDismiss: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [verifyWarning, setVerifyWarning] = useState(false);
  const isSignup = mode === "signup";
  const anyLoading = loading || googleLoading;

  const submit = async () => {
    setError("");
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

    setLoading(true);
    const trimmedEmail = email.trim();
    logger.info("auth_screen_submit", { mode: isSignup ? "signup" : "signin", email: trimmedEmail });
    try {
      if (isSignup) {
        const result: SignUpResult = await signUp(trimmedEmail, password);
        if (!result.verificationEmailSent) {
          setVerifyWarning(true);
        }
      } else {
        await signIn(trimmedEmail, password);
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
      if (code === "auth/email-already-in-use") setError("Email already in use. Try signing in, or use Google below.");
      else if (code === "auth/account-exists-with-different-credential")
        setError("This email is linked to Google. Tap 'Continue with Google' below.");
      else if (code === "auth/invalid-credential" || code === "auth/wrong-password")
        setError("Invalid email or password");
      else if (code === "auth/user-not-found") setError("No account with that email. Need to sign up?");
      else if (code === "auth/weak-password") setError("Password too weak (6+ chars)");
      else if (code === "auth/too-many-requests")
        setError("Too many attempts. Please wait a few minutes and try again.");
      else if (code === "auth/network-request-failed") setError("Network error — check your connection and try again.");
      else setError(getUserMessage(err, "Something went wrong"));
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
    try {
      await resetPassword(email);
      setResetSent(true);
    } catch (err) {
      logger.warn("auth_screen_password_reset_error", { error: parseFirebaseError(err) });
      setResetSent(true); // Don't reveal if email exists
    }
  };

  const displayError = error || googleError;

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm p-8 rounded-2xl glass-card animate-scale-in">
        <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none mb-4" aria-hidden="true" />
        <h2 className="font-display text-fluid-3xl text-white mb-1">{isSignup ? "Create Account" : "Welcome Back"}</h2>
        <p className="font-body text-sm text-muted mb-7">
          {isSignup ? "Join the crew. It's free." : "Sign in to continue your games."}
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
              enterKeyHint="go"
            />
          )}

          <ErrorBanner
            message={displayError}
            onDismiss={() => {
              setError("");
              onGoogleErrorDismiss();
            }}
          />

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
