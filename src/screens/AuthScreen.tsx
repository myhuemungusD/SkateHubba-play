import { useState } from "react";
import { signUp, signIn, resetPassword } from "../services/auth";
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
    logger.info("auth_screen_submit", { mode: isSignup ? "signup" : "signin", email: email.trim() });
    try {
      if (isSignup) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
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
        <span className="font-display text-sm tracking-[0.3em] text-brand-orange block mb-2">SKATEHUBBA™</span>
        <h2 className="font-display text-fluid-3xl text-white mb-1">{isSignup ? "Create Account" : "Welcome Back"}</h2>
        <p className="font-body text-sm text-[#888] mb-7">
          {isSignup ? "Join the crew. It's free." : "Sign in to continue your games."}
        </p>

        <GoogleButton onClick={onGoogle} loading={googleLoading} />

        <div className="flex items-center gap-3 my-5">
          <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
          <span className="font-body text-xs text-[#444]">or continue with email</span>
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
            value={email}
            onChange={setEmail}
            placeholder="you@email.com"
            icon="@"
            type="email"
            autoComplete="email"
          />
          <Field
            label="Password"
            value={password}
            onChange={setPassword}
            placeholder="••••••••"
            icon="🔒"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
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
              value={confirm}
              onChange={setConfirm}
              placeholder="••••••••"
              icon="🔒"
              type="password"
              autoComplete="new-password"
            />
          )}

          <ErrorBanner
            message={displayError}
            onDismiss={() => {
              setError("");
              onGoogleErrorDismiss();
            }}
          />

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
            className="w-full font-body text-xs text-[#555] text-center mt-3 cursor-pointer hover:text-white transition-colors duration-300 bg-transparent border-none"
            onClick={handleReset}
          >
            Forgot password?
          </button>
        )}

        <button
          type="button"
          className="w-full font-body text-sm text-[#555] text-center mt-5 cursor-pointer bg-transparent border-none transition-colors duration-300 hover:text-[#777]"
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
