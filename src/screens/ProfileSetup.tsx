import { useState, useEffect, useCallback } from "react";
import {
  AgeVerificationRequiredError,
  createProfile,
  getUserProfile,
  USERNAME_MAX,
  USERNAME_MIN,
  USERNAME_RE,
  type UserProfile,
} from "../services/users";
import { analytics } from "../services/analytics";
import { logger, metrics } from "../services/logger";
import { useUsernameAvailability } from "../hooks/useUsernameAvailability";
import { isMinorDob, parseDob } from "../utils/age";
import { Btn } from "../components/ui/Btn";
import { Field } from "../components/ui/Field";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { DobRow } from "../components/ui/DobRow";
import { CoppaBlockedCard } from "../components/CoppaBlockedCard";
import { SkateboardIcon } from "../components/icons";

const STANCES = [
  { value: "Regular", foot: "Left foot forward" },
  { value: "Goofy", foot: "Right foot forward" },
] as const;

// Sanitisation regex is the inverse of USERNAME_RE — strips any char that
// wouldn't pass validation. Kept local because only the UI pre-filters input.
const SANITIZE_RE = /[^a-z0-9_]/g;

function sanitizeDisplayName(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().replace(SANITIZE_RE, "").slice(0, USERNAME_MAX);
}

function usernameNote(name: string, available: boolean | null): string {
  if (name.length < USERNAME_MIN) return `Min ${USERNAME_MIN} characters, letters/numbers/underscore`;
  if (available === null) return "Checking...";
  const handle = `@${name}`;
  return available ? `${handle} is available ✓` : `${handle} is taken ✗`;
}

export function ProfileSetup({
  uid,
  emailVerified = false,
  displayName,
  onDone,
  dob,
  parentalConsent,
  onNavLegal,
}: {
  uid: string;
  emailVerified?: boolean;
  displayName?: string | null;
  onDone: (p: UserProfile) => void;
  /** DOB collected earlier in the flow (email signup path). When null the form
   *  renders inline DOB inputs so Google-signup users can complete COPPA. */
  dob?: string | null;
  parentalConsent?: boolean;
  /** Navigate to the privacy/terms screen from inline consent links. */
  onNavLegal?: (screen: "privacy" | "terms") => void;
}) {
  const [username, setUsername] = useState(() => sanitizeDisplayName(displayName));
  const [stance, setStance] = useState<(typeof STANCES)[number]["value"]>("Regular");
  const [localError, setLocalError] = useState("");
  const [loading, setLoading] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);
  // Inline DOB inputs — only shown when the upstream flow didn't provide a
  // DOB (Google signup skips AuthScreen, so we collect it here instead).
  const needsDobCollection = !dob;
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [parentConsent, setParentConsent] = useState(false);
  const [ageBlocked, setAgeBlocked] = useState(false);
  const isMinor = needsDobCollection && isMinorDob(month, day, year);

  const updateDob = (field: "month" | "day" | "year", value: string) => {
    if (field === "month") setMonth(value);
    else if (field === "day") setDay(value);
    else setYear(value);
  };

  const { available, error: availabilityError, clearError: clearAvailabilityError } = useUsernameAvailability(username);
  // Display whichever error is non-empty. Local validation/submit errors take
  // precedence over the hook's transient availability error.
  const error = localError || availabilityError;
  const clearError = useCallback(() => {
    setLocalError("");
    clearAvailabilityError();
  }, [clearAvailabilityError]);

  // If the user already has a profile (e.g. profile fetch timed out on sign-in),
  // skip setup entirely and resolve with the existing profile.
  useEffect(() => {
    let cancelled = false;
    getUserProfile(uid)
      .then((existing) => {
        if (cancelled) return;
        if (existing) {
          logger.info("profile_setup_existing_found", { uid, username: existing.username });
          onDone(existing);
        } else {
          setCheckingExisting(false);
        }
      })
      .catch(() => {
        if (!cancelled) setCheckingExisting(false);
      });
    return () => {
      cancelled = true;
    };
    // Only run on mount — uid and onDone are stable for the lifetime of this screen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  const canSubmit =
    !loading && username.length >= USERNAME_MIN && username.length <= USERNAME_MAX && available === true;

  const submit = async () => {
    clearError();
    const normalized = username.trim();
    if (normalized.length < USERNAME_MIN) {
      setLocalError(`Username must be ${USERNAME_MIN}+ characters`);
      return;
    }
    if (normalized.length > USERNAME_MAX) {
      setLocalError(`Username too long (max ${USERNAME_MAX})`);
      return;
    }
    /* v8 ignore start -- regex guard unreachable after length validation; defensive for malformed input */
    if (!USERNAME_RE.test(normalized)) {
      setLocalError("Only letters, numbers, and _ allowed");
      return;
    }
    /* v8 ignore stop */
    if (available === false) {
      setLocalError("Username is taken");
      return;
    }
    if (available === null) {
      setLocalError("Still checking username — wait a moment");
      return;
    }

    let effectiveDob = dob ?? undefined;
    let effectiveConsent = parentalConsent;
    if (needsDobCollection) {
      const result = parseDob(month, day, year);
      if (result.kind === "invalid") {
        setLocalError(result.message);
        return;
      }
      if (result.kind === "blocked") {
        logger.info("age_gate_blocked", { age: result.age });
        setAgeBlocked(true);
        return;
      }
      if (result.needsParentalConsent && !parentConsent) {
        setLocalError("Parental or guardian consent is required for users under 18");
        return;
      }
      effectiveDob = result.dobString;
      effectiveConsent = result.needsParentalConsent;
      logger.info("age_gate_passed_inline", { age: result.age, parentalConsent: effectiveConsent });
    }

    setLoading(true);
    try {
      const profile = await createProfile(uid, normalized, stance, emailVerified, effectiveDob, effectiveConsent);
      metrics.signUp("google", uid);
      analytics.signUp("google");
      onDone(profile);
    } catch (err: unknown) {
      // Defensive: the inline DOB collection above should catch missing-age
      // cases client-side, but if the service still rejects (e.g. malformed
      // cached DOB prop) surface a recovery message instead of a raw Error.
      if (err instanceof AgeVerificationRequiredError) {
        logger.warn("profile_setup_age_verification_required", { uid });
        setLocalError("Please enter your date of birth to continue.");
        return;
      }
      setLocalError(err instanceof Error ? err.message : "Could not create profile");
    } finally {
      setLoading(false);
    }
  };

  if (checkingExisting) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-6">
        <span
          role="status"
          aria-label="Checking profile"
          className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin"
        />
      </div>
    );
  }

  if (ageBlocked) {
    return (
      <CoppaBlockedCard
        onBack={() => {
          // Clear the failing DOB so the form doesn't re-block immediately on
          // next submit. Preserve username + stance so the user doesn't lose
          // their progress.
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
        <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none mb-6" aria-hidden="true" />
        <h2 className="font-display text-3xl text-white mb-1">Pick your handle</h2>
        <p className="font-body text-sm text-muted mb-7">
          Choose your username and stance. Your username can&apos;t be changed.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          noValidate
        >
          <Field
            label="Username"
            name="username"
            value={username}
            onChange={(v) => {
              if (!loading) setUsername(v.toLowerCase().replace(SANITIZE_RE, ""));
            }}
            placeholder="sk8legend"
            maxLength={USERNAME_MAX}
            icon="@"
            autoComplete="username"
            autoFocus
            inputMode="text"
            enterKeyHint="next"
            note={usernameNote(username, available)}
          />

          {username.length >= USERNAME_MIN && available !== null && (
            <div
              className={`flex items-center gap-2 -mt-2 mb-5 px-1 transition-all duration-300 ${
                available ? "text-brand-green" : "text-brand-red"
              }`}
            >
              <div className={`w-2 h-2 rounded-full ${available ? "bg-brand-green" : "bg-brand-red"}`} />
              <span className="font-body text-xs">{available ? "You're good to go" : "Try another name"}</span>
            </div>
          )}

          <label className="block font-display text-sm tracking-[0.12em] text-dim mb-2">Stance</label>
          <div className="flex gap-3 mb-6" role="radiogroup" aria-label="Skating stance">
            {STANCES.map(({ value, foot }) => {
              const selected = stance === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setStance(value)}
                  className={`flex-1 py-4 rounded-2xl font-display text-base tracking-wider cursor-pointer transition-all duration-300 ease-smooth ${
                    selected
                      ? "bg-brand-orange/[0.08] border-2 border-brand-orange text-brand-orange scale-[1.02] shadow-glow-sm ring-1 ring-brand-orange/20"
                      : "bg-surface-alt/60 backdrop-blur-sm border-2 border-border text-faint hover:border-border-hover hover:text-muted hover:bg-white/[0.02]"
                  }`}
                >
                  <div className="flex justify-center mb-1.5" aria-hidden="true">
                    <SkateboardIcon size={22} className={selected ? "text-brand-orange" : "text-faint"} />
                  </div>
                  <div>{value}</div>
                  <div className="font-body text-[10px] text-subtle mt-0.5 tracking-normal">{foot}</div>
                </button>
              );
            })}
          </div>

          {needsDobCollection && (
            <>
              <label className="block font-display text-sm tracking-[0.12em] text-dim mb-2">Date of Birth</label>
              <DobRow month={month} day={day} year={year} onChange={updateDob} disabled={loading} />
              <p className="font-body text-xs text-subtle mb-5">
                Used only for age verification (COPPA &amp; CCPA) and is never shared.
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

          <ErrorBanner message={error} onDismiss={clearError} />

          <Btn type="submit" disabled={!canSubmit}>
            {loading ? (
              <span className="inline-flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Creating...
              </span>
            ) : (
              "Lock It In"
            )}
          </Btn>
        </form>
      </div>
    </div>
  );
}
