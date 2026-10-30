import { AppleButton } from "./AppleButton";
import { GoogleButton } from "./GoogleButton";
import { TermsAgreementNotice, type LegalDoc } from "./legal/TermsAgreementNotice";
import { Field } from "./ui/Field";

/**
 * The top of the auth card: Apple (when enabled) and Google buttons, the terms
 * notice, and the "or continue with email" divider. Shared by AuthScreen and
 * the pre-auth BootAuth shell so the two cards cannot drift. Must not import
 * Firebase — BootAuth lives on the entry chunk.
 */
export function AuthSocialSection({
  appleOn,
  onApple,
  appleLoading,
  onGoogle,
  googleLoading,
  onNavLegal,
}: {
  appleOn: boolean;
  onApple: () => void;
  appleLoading: boolean;
  onGoogle: () => void;
  googleLoading: boolean;
  onNavLegal?: (doc: LegalDoc) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-3">
        {appleOn ? <AppleButton onClick={onApple} loading={appleLoading} disabled={googleLoading} /> : null}
        <GoogleButton onClick={onGoogle} loading={googleLoading} disabled={appleOn && appleLoading} />
        <TermsAgreementNotice onNav={onNavLegal} />
      </div>

      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
        <span className="font-body text-xs text-subtle">or continue with email</span>
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
      </div>
    </>
  );
}

/** The auth card's email input. */
export function AuthEmailField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Field
      label="Email"
      name="email"
      value={value}
      onChange={onChange}
      placeholder="you@email.com"
      icon="@"
      type="email"
      autoComplete="email"
      inputMode="email"
      enterKeyHint="next"
    />
  );
}
