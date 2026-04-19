import { useState, useCallback } from "react";
import { Btn } from "../components/ui/Btn";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { logger } from "../services/logger";

/** Minimum age to use the app (COPPA). */
const MIN_AGE = 13;
/** Age at which parental consent is no longer required. */
const ADULT_AGE = 18;

function getAge(dob: Date): number {
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function AgeGate({
  onVerified,
  onBack,
  onNav,
}: {
  onVerified: (dob: string, parentalConsent: boolean) => void;
  onBack: () => void;
  onNav: (screen: "privacy" | "terms") => void;
}) {
  const [month, setMonth] = useState("");
  const [day, setDay] = useState("");
  const [year, setYear] = useState("");
  const [parentConsent, setParentConsent] = useState(false);
  const [error, setError] = useState("");
  const [blocked, setBlocked] = useState(false);

  const validate = useCallback(() => {
    setError("");
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    const y = parseInt(year, 10);

    if (!m || !d || !y || isNaN(m) || isNaN(d) || isNaN(y)) {
      setError("Please enter your full date of birth");
      return;
    }
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > new Date().getFullYear()) {
      setError("Please enter a valid date");
      return;
    }

    const dob = new Date(y, m - 1, d);
    // Verify the date is valid (e.g. not Feb 30)
    if (dob.getMonth() !== m - 1 || dob.getDate() !== d) {
      setError("Please enter a valid date");
      return;
    }

    const age = getAge(dob);

    if (age < MIN_AGE) {
      logger.info("age_gate_blocked", { age });
      setBlocked(true);
      return;
    }

    const needsParentalConsent = age < ADULT_AGE;
    if (needsParentalConsent && !parentConsent) {
      setError("Parental or guardian consent is required for users under 18");
      return;
    }

    const dobString = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    logger.info("age_gate_passed", { age, parentalConsent: needsParentalConsent });
    onVerified(dobString, needsParentalConsent);
  }, [month, day, year, parentConsent, onVerified]);

  const isMinor = (() => {
    const m = parseInt(month, 10);
    const d = parseInt(day, 10);
    const y = parseInt(year, 10);
    if (!m || !d || !y || isNaN(m) || isNaN(d) || isNaN(y)) return false;
    const dob = new Date(y, m - 1, d);
    if (dob.getMonth() !== m - 1) return false;
    const age = getAge(dob);
    return age >= MIN_AGE && age < ADULT_AGE;
  })();

  if (blocked) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm p-8 rounded-2xl glass-card animate-scale-in text-center">
          <img
            src="/logonew.webp"
            alt=""
            draggable={false}
            className="h-7 w-auto select-none mb-5"
            aria-hidden="true"
          />
          <h2 className="font-display text-3xl text-white mb-3">Sorry!</h2>
          <p className="font-body text-sm text-muted mb-6 leading-relaxed">
            You must be at least {MIN_AGE} years old to use SkateHubba. This is required by the Children&apos;s Online
            Privacy Protection Act (COPPA).
          </p>
          <p className="font-body text-xs text-faint mb-6">
            We do not collect or store any personal information from users under {MIN_AGE}. No account has been created.
          </p>
          <Btn onClick={onBack}>Go Back</Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm p-8 rounded-2xl glass-card animate-scale-in">
        <img src="/logonew.webp" alt="" draggable={false} className="h-7 w-auto select-none mb-4" aria-hidden="true" />
        <h2 className="font-display text-3xl text-white mb-1">Verify Your Age</h2>
        <p className="font-body text-sm text-muted mb-7">
          We need your date of birth to comply with U.S. privacy laws (COPPA &amp; CCPA).
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            validate();
          }}
          noValidate
        >
          <label className="block font-display text-sm tracking-[0.12em] text-dim mb-2">Date of Birth</label>
          <div className="flex gap-3 mb-2">
            <div className="flex-1">
              <input
                type="text"
                inputMode="numeric"
                placeholder="MM"
                maxLength={2}
                value={month}
                onChange={(e) => setMonth(e.target.value.replace(/\D/g, ""))}
                autoFocus
                className="w-full bg-surface-alt/80 backdrop-blur-sm border border-border rounded-2xl text-white text-base font-body outline-none
                  focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1),0_0_16px_rgba(255,107,0,0.06)] transition-all duration-300 px-4 py-3.5 text-center"
                aria-label="Birth month"
              />
            </div>
            <div className="flex-1">
              <input
                type="text"
                inputMode="numeric"
                placeholder="DD"
                maxLength={2}
                value={day}
                onChange={(e) => setDay(e.target.value.replace(/\D/g, ""))}
                className="w-full bg-surface-alt/80 backdrop-blur-sm border border-border rounded-2xl text-white text-base font-body outline-none
                  focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1),0_0_16px_rgba(255,107,0,0.06)] transition-all duration-300 px-4 py-3.5 text-center"
                aria-label="Birth day"
              />
            </div>
            <div className="flex-[1.5]">
              <input
                type="text"
                inputMode="numeric"
                placeholder="YYYY"
                maxLength={4}
                value={year}
                onChange={(e) => setYear(e.target.value.replace(/\D/g, ""))}
                className="w-full bg-surface-alt/80 backdrop-blur-sm border border-border rounded-2xl text-white text-base font-body outline-none
                  focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1),0_0_16px_rgba(255,107,0,0.06)] transition-all duration-300 px-4 py-3.5 text-center"
                aria-label="Birth year"
              />
            </div>
          </div>
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
              />
              <span className="font-body text-sm text-dim leading-relaxed group-hover:text-[#bbb] transition-colors">
                My parent or legal guardian has reviewed the{" "}
                <button type="button" onClick={() => onNav("privacy")} className="text-brand-orange hover:underline">
                  Privacy Policy
                </button>{" "}
                and{" "}
                <button type="button" onClick={() => onNav("terms")} className="text-brand-orange hover:underline">
                  Terms of Service
                </button>{" "}
                and consents to my use of SkateHubba.
              </span>
            </label>
          )}

          <ErrorBanner message={error} onDismiss={() => setError("")} />

          <Btn type="submit">Continue</Btn>
        </form>

        <button
          type="button"
          className="w-full font-body text-sm text-subtle text-center mt-5 cursor-pointer bg-transparent border-none"
          onClick={onBack}
        >
          <span className="text-brand-orange">← Back</span>
        </button>
      </div>
    </div>
  );
}
