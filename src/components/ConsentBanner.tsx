import { useState } from "react";

const CONSENT_KEY = "sh_analytics_consent";

export function ConsentBanner({ onNav }: { onNav: (screen: "privacy" | "terms") => void }) {
  // Initialise synchronously from localStorage so the banner never flickers
  // in on a second render (avoids calling setState inside an effect).
  const [visible, setVisible] = useState(() => !localStorage.getItem(CONSENT_KEY));

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, "accepted");
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem(CONSENT_KEY, "declined");
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Cookie and analytics notice"
      className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-safe-bottom"
    >
      <div className="max-w-lg mx-auto mb-4 rounded-2xl border border-[#333] bg-[#111] px-5 py-4 shadow-2xl animate-fade-in">
        <p className="font-body text-sm text-[#aaa] leading-relaxed mb-3">
          We use privacy-friendly, cookie-free analytics to understand how the app is used. No personal data is shared
          with advertisers.{" "}
          <button
            type="button"
            onClick={() => onNav("privacy")}
            className="text-brand-orange underline underline-offset-2"
          >
            Privacy Policy
          </button>
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={accept}
            className="flex-1 py-2 rounded-xl bg-brand-orange font-display text-sm text-white tracking-wider hover:opacity-90 transition-opacity"
          >
            OK
          </button>
          <button
            type="button"
            onClick={decline}
            className="flex-1 py-2 rounded-xl border border-[#333] font-body text-sm text-[#777] hover:text-[#aaa] transition-colors"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
