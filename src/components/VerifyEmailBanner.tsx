import { useState, useEffect } from "react";
import { resendVerification } from "../services/auth";

const RESEND_COOLDOWN_S = 60;

export function VerifyEmailBanner({ emailVerified }: { emailVerified: boolean }) {
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [sendError, setSendError] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (emailVerified) return null;

  const handleResend = async () => {
    setSending(true);
    setSendError(false);
    try {
      await resendVerification();
      setCooldown(RESEND_COOLDOWN_S);
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  };

  const btnLabel = sending ? "..." : cooldown > 0 ? `${cooldown}s` : sendError ? "Retry" : "Resend";

  return (
    <div className="mx-5 mt-4 p-3.5 rounded-xl bg-[rgba(255,107,0,0.06)] border border-brand-orange flex items-center justify-between gap-3">
      <div>
        <span className="font-display text-xs tracking-wider text-brand-orange block">VERIFY YOUR EMAIL</span>
        <span className="font-body text-xs text-muted">
          {sendError ? "Failed to send — check your connection." : "Check your inbox for the verification link."}
        </span>
      </div>
      <button
        type="button"
        onClick={handleResend}
        disabled={sending || cooldown > 0}
        className="font-display text-[11px] tracking-wider text-brand-orange border border-brand-orange rounded-lg px-3 py-1.5 whitespace-nowrap disabled:opacity-40 transition-opacity"
        aria-label={cooldown > 0 ? `Resend available in ${cooldown} seconds` : "Resend verification email"}
      >
        {btnLabel}
      </button>
    </div>
  );
}
