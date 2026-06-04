/**
 * COPPA/CCPA date-of-birth + parental-consent fieldset, shared by AuthScreen
 * (email signup) and ProfileSetup (Google signup fallback). Presentational
 * only — it captures three DOB strings plus a consent flag and emits changes.
 *
 * Validation lives in `src/utils/age.ts`. Callers feed the captured month/day/
 * year into `parseDob()` and decide `showConsent` via `isMinorDob()`; this
 * component never runs the age logic itself, navigates, or calls services.
 */

import { DobRow, type DobField } from "./ui/DobRow";

export function DobConsentFields({
  month,
  day,
  year,
  onDobChange,
  disabled,
  helpText,
  showConsent,
  consent,
  onConsentChange,
  onNavLegal,
}: {
  month: string;
  day: string;
  year: string;
  onDobChange: (field: DobField, value: string) => void;
  /** Disables the DOB inputs while an async action is in flight. */
  disabled?: boolean;
  /** Per-surface helper copy under the DOB row. */
  helpText: string;
  /** Reveal the parental-consent checkbox (caller derives via isMinorDob). */
  showConsent: boolean;
  consent: boolean;
  onConsentChange: (checked: boolean) => void;
  /** Navigate to the privacy/terms screen from inline consent links. */
  onNavLegal?: (screen: "privacy" | "terms") => void;
}) {
  return (
    <>
      <label className="block font-display text-sm tracking-[0.12em] text-dim mb-2">Date of Birth</label>
      <DobRow month={month} day={day} year={year} onChange={onDobChange} disabled={disabled} />
      <p className="font-body text-xs text-subtle mb-5">{helpText}</p>
      {showConsent && (
        <label className="flex items-start gap-3 mb-5 cursor-pointer group">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => onConsentChange(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-brand-orange cursor-pointer shrink-0"
            aria-label="Parental consent"
          />
          <span className="font-body text-sm text-dim leading-relaxed group-hover:text-bright transition-colors">
            My parent or legal guardian has reviewed the{" "}
            <button type="button" onClick={() => onNavLegal?.("privacy")} className="text-brand-orange hover:underline">
              Privacy Policy
            </button>{" "}
            and{" "}
            <button type="button" onClick={() => onNavLegal?.("terms")} className="text-brand-orange hover:underline">
              Terms of Service
            </button>{" "}
            and consents to my use of SkateHubba.
          </span>
        </label>
      )}
    </>
  );
}
