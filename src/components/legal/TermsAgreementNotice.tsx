import type { MouseEvent } from "react";

export type LegalDoc = "terms" | "privacy";

const LEGAL_HREF: Record<LegalDoc, string> = { terms: "/terms", privacy: "/privacy" };

/**
 * Inline legal link. A real `href` keeps it working with no handler (and lets
 * long-press / open-in-new-tab work on the web); when the caller passes
 * `onNav` we route in-app instead so typed form state is not lost to a reload.
 */
export function LegalLink({
  doc,
  onNav,
  children,
}: {
  doc: LegalDoc;
  onNav?: (doc: LegalDoc) => void;
  children: string;
}) {
  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onNav) return;
    e.preventDefault();
    onNav(doc);
  };
  return (
    <a
      href={LEGAL_HREF[doc]}
      onClick={handleClick}
      className="text-brand-orange underline underline-offset-2 hover:text-white rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
    >
      {children}
    </a>
  );
}

/**
 * App Review Guideline 1.2: users must agree to terms that ban objectionable
 * content before they can sign in or sign up. Rendered under every sign-in /
 * sign-up button group (Landing, AuthScreen, the boot auth shell). The
 * explicit, recorded agreement is the required checkbox on ProfileSetup.
 */
export function TermsAgreementNotice({
  onNav,
  className = "",
}: {
  onNav?: (doc: LegalDoc) => void;
  className?: string;
}) {
  return (
    <p
      data-testid="terms-agreement-notice"
      className={`font-body text-xs text-subtle text-center leading-relaxed ${className}`}
    >
      By continuing you agree to our{" "}
      <LegalLink doc="terms" onNav={onNav}>
        Terms
      </LegalLink>{" "}
      and{" "}
      <LegalLink doc="privacy" onNav={onNav}>
        Privacy Policy
      </LegalLink>
      . Zero tolerance for objectionable content or abusive users.
    </p>
  );
}
