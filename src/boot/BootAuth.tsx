import { useState } from "react";
import { useNavigate } from "react-router";
import { AuthEmailField, AuthSocialSection } from "../components/AuthSocialSection";
import { DobConsentFields } from "../components/DobConsentFields";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { isAppleSignInEnabled } from "../lib/featureFlags";
import {
  hasBootAppleSignIn,
  hasBootGoogleSignIn,
  peekBootAuthDraft,
  peekBootAuthMode,
  requestBootAppleSignIn,
  requestBootGoogleSignIn,
  setBootAuthMode,
  updateBootAuthDraft,
} from "./landingBoot";

/**
 * Static signup/sign-in shell painted before Firebase Auth resolves.
 *
 * The real AuthScreen is the same card, mounted once App can render it.
 * Keystrokes land in the boot draft so they survive that handoff. This
 * module must not import Firebase — it lives on the entry chunk.
 */
export function BootAuth() {
  const navigate = useNavigate();
  const draft = peekBootAuthDraft();
  const [mode, setMode] = useState<"signup" | "signin">(peekBootAuthMode() ?? "signup");
  const [email, setEmail] = useState(draft.email);
  const [password, setPassword] = useState(draft.password);
  const [confirm, setConfirm] = useState(draft.confirm);
  const [month, setMonth] = useState(draft.month);
  const [day, setDay] = useState(draft.day);
  const [year, setYear] = useState(draft.year);
  const [parentConsent, setParentConsent] = useState(draft.parentConsent);
  const [googlePending, setGooglePending] = useState(hasBootGoogleSignIn);
  const [applePending, setApplePending] = useState(hasBootAppleSignIn);
  const isSignup = mode === "signup";
  const appleOn = isAppleSignInEnabled();
  const socialLoading = googlePending || (appleOn && applePending);

  const remember = (patch: Parameters<typeof updateBootAuthDraft>[0]) => {
    updateBootAuthDraft(patch);
  };

  return (
    <div className="min-h-dvh flex flex-col items-center px-6 pt-[max(env(safe-area-inset-top),1.25rem)] pb-[calc(var(--consent-banner-space,0px)+1.25rem)]">
      <div className="my-auto w-full max-w-sm p-6 sm:p-8 rounded-2xl glass-card">
        <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none mb-4" aria-hidden="true" />
        <h2 className="font-display text-fluid-3xl text-white mb-1">{isSignup ? "Create Account" : "Welcome Back"}</h2>
        <p className="font-body text-sm text-muted mb-5 sm:mb-7">
          {isSignup
            ? "Join the crew. It's free. We ask for your birthday to keep SkateHubba 13+."
            : "Sign in to continue your games."}
        </p>

        <AuthSocialSection
          appleOn={appleOn}
          onApple={() => {
            requestBootAppleSignIn();
            setApplePending(true);
          }}
          appleLoading={applePending}
          onGoogle={() => {
            requestBootGoogleSignIn();
            setGooglePending(true);
          }}
          googleLoading={googlePending}
          onNavLegal={(doc) => navigate(doc === "privacy" ? "/privacy" : "/terms")}
        />

        <form
          onSubmit={(e) => {
            e.preventDefault();
          }}
          noValidate
          aria-busy={socialLoading || undefined}
          className={`transition-opacity duration-200 ${socialLoading ? "opacity-40 pointer-events-none" : ""}`}
        >
          <AuthEmailField
            value={email}
            onChange={(value) => {
              setEmail(value);
              remember({ email: value });
            }}
          />
          <Field
            label="Password"
            name="password"
            value={password}
            onChange={(value) => {
              setPassword(value);
              remember({ password: value });
            }}
            placeholder="••••••••"
            icon="🔒"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            enterKeyHint={isSignup ? "next" : "go"}
          />
          {isSignup && (
            <Field
              label="Confirm"
              name="confirm-password"
              value={confirm}
              onChange={(value) => {
                setConfirm(value);
                remember({ confirm: value });
              }}
              placeholder="••••••••"
              icon="🔒"
              type="password"
              autoComplete="new-password"
              enterKeyHint="next"
            />
          )}
          {isSignup && (
            <DobConsentFields
              month={month}
              day={day}
              year={year}
              onDobChange={(field, value) => {
                if (field === "month") setMonth(value);
                else if (field === "day") setDay(value);
                else setYear(value);
                remember({ [field]: value });
              }}
              disabled={socialLoading}
              helpText="Your date of birth is used only for age verification and is never shared."
              showConsent={false}
              consent={parentConsent}
              onConsentChange={(value) => {
                setParentConsent(value);
                remember({ parentConsent: value });
              }}
              onNavLegal={(screen) => navigate(screen === "privacy" ? "/privacy" : "/terms")}
            />
          )}
          <Btn type="submit" disabled={socialLoading}>
            {isSignup ? "Create Account" : "Sign In"}
          </Btn>
        </form>

        <button
          type="button"
          className="w-full touch-target font-body text-sm text-dim text-center mt-3 cursor-pointer bg-transparent border-none transition-colors duration-300 hover:text-white rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          onClick={() => {
            const next = isSignup ? "signin" : "signup";
            setMode(next);
            setBootAuthMode(next);
          }}
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
