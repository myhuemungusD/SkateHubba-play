import { LegalLink, type LegalDoc } from "./TermsAgreementNotice";

/**
 * Required "I agree" checkbox on ProfileSetup (App Review Guideline 1.2).
 * ProfileSetup blocks submit until it is ticked and createProfile records
 * users/{uid}/private/profile.termsAcceptedAt with server time.
 *
 * Accessibility: no aria-label, so the whole label text (including the
 * zero-tolerance sentence) is the checkbox's accessible name for VoiceOver.
 * After an unchecked submit, `invalid` + `errorId` mark it aria-invalid and
 * point aria-describedby at the visible error message.
 */
export function TermsAcceptCheckbox({
  checked,
  onChange,
  disabled,
  onNav,
  invalid = false,
  errorId,
}: {
  checked: boolean;
  invalid?: boolean;
  errorId?: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  onNav?: (doc: LegalDoc) => void;
}) {
  return (
    <label className="flex items-start gap-3 mb-5 min-h-11 cursor-pointer group">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-required="true"
        aria-invalid={invalid || undefined}
        aria-describedby={invalid && errorId ? errorId : undefined}
        data-testid="terms-accept"
        className="mt-0.5 w-5 h-5 accent-brand-orange cursor-pointer shrink-0"
      />
      <span className="font-body text-sm text-dim leading-relaxed group-hover:text-bright transition-colors">
        I agree to the{" "}
        <LegalLink doc="terms" onNav={onNav}>
          Terms of Service
        </LegalLink>{" "}
        and{" "}
        <LegalLink doc="privacy" onNav={onNav}>
          Privacy Policy
        </LegalLink>
        . Zero tolerance for objectionable content or abusive users.
      </span>
    </label>
  );
}
