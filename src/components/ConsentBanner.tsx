import { useState } from "react";

const CONSENT_KEY = "sh_analytics_consent";

/** Read a key from localStorage, treating any throw (Safari private mode,
 *  disabled storage, quota errors) as "unknown" so the caller decides the
 *  default. Reading inline in useState's initializer would otherwise crash
 *  the component on mount in those environments. */
function readConsent(): string | null {
  try {
    return localStorage.getItem(CONSENT_KEY);
  } catch {
    return null;
  }
}

function writeConsent(value: "accepted" | "declined"): void {
  try {
    localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Best-effort — in private mode we can't persist, but the session-scoped
    // `visible=false` below still hides the banner for this tab.
  }
}

export function ConsentBanner({ onNav }: { onNav: (screen: "privacy" | "terms") => void }) {
  // Initialise synchronously from localStorage so the banner never flickers
  // in on a second render (avoids calling setState inside an effect).
  const [visible, setVisible] = useState(() => !readConsent());

  const accept = () => {
    writeConsent("accepted");
    setVisible(false);
  };

  const decline = () => {
    writeConsent("declined");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Cookie and analytics notice"
      className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-safe"
    >
      <div className="max-w-lg mx-auto mb-4 rounded-2xl glass-card px-4 py-3 shadow-glass animate-scale-in">
        <div className="flex items-center gap-3">
          <p className="font-body text-xs text-[#aaa] leading-snug flex-1">
            Cookie-free analytics.{" "}
            <button
              type="button"
              onClick={() => onNav("privacy")}
              className="text-brand-orange underline underline-offset-2"
            >
              Privacy&nbsp;Policy
            </button>
          </p>
          <div className="flex gap-2 flex-shrink-0">
            <button
              type="button"
              onClick={accept}
              className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-brand-orange to-[#FF8533] font-display text-xs text-white tracking-wider hover:shadow-glow-sm active:scale-[0.97] transition-all duration-300 ring-1 ring-white/[0.08]"
            >
              OK
            </button>
            <button
              type="button"
              onClick={decline}
              className="px-3 py-1.5 rounded-xl border border-border font-body text-xs text-subtle hover:text-muted hover:border-border-hover transition-all duration-300"
            >
              No
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
