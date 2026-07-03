import { useState, useEffect, useRef } from "react";
import { resendVerification, reloadUser } from "../services/auth";
import { getErrorCode } from "../utils/helpers";
import { captureException } from "../lib/sentry";

const RESEND_COOLDOWN_S = 60;
const RATE_LIMIT_COOLDOWN_S = 300;
const LS_KEY = "skatehubba_resend_cooldown_until";

/** Read remaining cooldown seconds from localStorage (survives page refresh). */
function readStoredCooldown(): number {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return 0;
    const remaining = Math.ceil((Number(raw) - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
  } catch {
    return 0;
  }
}

function writeStoredCooldown(seconds: number): void {
  try {
    localStorage.setItem(LS_KEY, String(Date.now() + seconds * 1000));
  } catch {
    /* localStorage unavailable — in-memory cooldown still works */
  }
}

export function VerifyEmailBanner({ emailVerified }: { emailVerified: boolean }) {
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(readStoredCooldown);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [checking, setChecking] = useState(false);

  // Single setInterval owned by a ref so we never recreate the timer on every
  // tick. The previous useEffect-on-`cooldown` pattern re-armed a fresh
  // setTimeout once per second, which subtly drifted the displayed value
  // whenever React batched a render. The interval fires every 1000ms and
  // self-clears once the counter hits 0 (or on unmount).
  const intervalRef = useRef<number | null>(null);
  useEffect(() => {
    if (cooldown <= 0 || intervalRef.current !== null) return;
    intervalRef.current = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (intervalRef.current !== null) {
            window.clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [cooldown]);

  if (emailVerified) return null;

  const handleResend = async () => {
    setSending(true);
    setSendError(null);
    try {
      await resendVerification();
      writeStoredCooldown(RESEND_COOLDOWN_S);
      setCooldown(RESEND_COOLDOWN_S);
      setSent(true);
    } catch (err) {
      const code = getErrorCode(err);
      captureException(err, { extra: { context: "VerifyEmailBanner resend" } });
      if (code === "auth/too-many-requests") {
        writeStoredCooldown(RATE_LIMIT_COOLDOWN_S);
        setCooldown(RATE_LIMIT_COOLDOWN_S);
        setSendError("Too many attempts — please wait 5 minutes before retrying.");
      } else {
        // Apply the standard 60s cooldown on ANY failure — otherwise the
        // button is spammable and users hammer it until Firebase throttles
        // them into the 5-minute cooldown branch above.
        writeStoredCooldown(RESEND_COOLDOWN_S);
        setCooldown(RESEND_COOLDOWN_S);
        setSendError("Failed to send — check your connection.");
      }
    } finally {
      setSending(false);
    }
  };

  const handleCheckNow = async () => {
    setChecking(true);
    try {
      // reloadUser() force-refreshes the ID token if verified. useAuth's
      // reload tick then re-renders us with emailVerified=true and this
      // component returns null. Errors are non-critical — swallow them
      // so the button doesn't need its own error surface.
      await reloadUser();
    } catch {
      /* best-effort — user can retry */
    } finally {
      setChecking(false);
    }
  };

  const statusMessage =
    sendError ??
    (sent
      ? "Sent! Check your inbox and spam/junk folder."
      : "Check your inbox and spam/junk folder for the verification link.");
  const btnLabel = sending ? "..." : cooldown > 0 ? `${cooldown}s` : sendError !== null ? "Retry" : "Resend";

  const resendAriaLabel = sending
    ? "Sending verification email"
    : cooldown > 0
      ? `Resend available in ${cooldown} seconds`
      : "Resend verification email";

  return (
    <div
      role="status"
      className="mx-5 mt-4 p-3.5 rounded-2xl bg-[rgba(255,107,0,0.06)] border border-brand-orange/40 flex items-center justify-between gap-3 shadow-[0_0_16px_rgba(255,107,0,0.06)] animate-fade-in"
    >
      <div>
        <span className="font-display text-xs tracking-wider text-brand-orange block">VERIFY YOUR EMAIL</span>
        <span className="font-body text-xs text-muted" aria-live="polite">
          {statusMessage}
        </span>
        {/* Desktop users with side-by-side tabs never trigger
            visibilitychange, so surface a manual affordance to force a
            token reload after they click the verification link. */}
        <button
          type="button"
          onClick={handleCheckNow}
          disabled={checking}
          className="mt-1 inline-flex items-center font-body text-[11px] text-subtle underline underline-offset-2 hover:text-brand-orange disabled:opacity-40 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange rounded"
          aria-busy={checking}
          aria-label={checking ? "Checking verification status" : "I verified my email — check now"}
        >
          {checking ? "Checking…" : "I verified — check now"}
        </button>
      </div>
      <button
        type="button"
        onClick={handleResend}
        disabled={sending || cooldown > 0}
        className="touch-target inline-flex items-center justify-center font-display text-[11px] tracking-wider text-brand-orange border border-brand-orange/40 rounded-xl px-3.5 py-1.5 whitespace-nowrap disabled:opacity-40 hover:bg-brand-orange/[0.08] hover:border-brand-orange/60 active:scale-[0.97] transition-all duration-300"
        aria-label={resendAriaLabel}
        aria-busy={sending}
      >
        {btnLabel}
      </button>
    </div>
  );
}
