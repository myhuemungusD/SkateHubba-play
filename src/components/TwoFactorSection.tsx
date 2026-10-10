import { useEffect, useState } from "react";
import QRCode from "qrcode";
import type { TotpSecret } from "firebase/auth";
import {
  MFA_UNAVAILABLE,
  beginTotpEnrollment,
  confirmTotpEnrollment,
  listTotpFactors,
  reauthMethod,
  reauthenticateForMfa,
  unenrollTotpFactor,
  type ReauthMethod,
} from "../services/mfa.enroll";
import { getErrorCode } from "../utils/errors";

type Pending = "enroll" | "unenroll";

interface Setup {
  secret: TotpSecret;
  secretKey: string;
  qrCodeUrl: string;
}

function messageFrom(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

/**
 * Settings control for authenticator-app two-step verification.
 *
 * Enrollment is QR code plus the manual key, then a 6-digit code.
 * Firebase demands a recent sign-in; that failure opens a re-auth step
 * and retries the same action. If TOTP is not enabled on the Firebase
 * project, the card stays on a "not available yet" message.
 */
export function TwoFactorSection() {
  const [factors, setFactors] = useState(() => listTotpFactors());
  const [setup, setSetup] = useState<Setup | null>(null);
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!setup) return;
    let cancelled = false;
    QRCode.toDataURL(setup.qrCodeUrl, { margin: 1, width: 192, errorCorrectionLevel: "M" })
      .then((url) => {
        if (!cancelled) setQrSrc(url);
      })
      .catch(() => {
        if (!cancelled) setQrSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [setup]);

  function refresh(): void {
    setFactors(listTotpFactors());
    setSetup(null);
    setQrSrc(null);
    setCode("");
    setPassword("");
    setPending(null);
    setError("");
  }

  function onFlowError(err: unknown, next: Pending): void {
    const code = getErrorCode(err);
    if (code === "auth/requires-recent-login") {
      setError("");
      setPending(next);
      return;
    }
    if (code === MFA_UNAVAILABLE) {
      setUnavailable(true);
      setPending(null);
      setError("");
      return;
    }
    setError(messageFrom(err));
  }

  async function startEnroll(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const next = await beginTotpEnrollment();
      setSetup(next);
      setQrSrc(null);
      setPending(null);
    } catch (err) {
      onFlowError(err, "enroll");
    } finally {
      setBusy(false);
    }
  }

  async function finishEnroll(): Promise<void> {
    if (!setup) return;
    setBusy(true);
    setError("");
    try {
      await confirmTotpEnrollment(setup.secret, code);
      refresh();
    } catch (err) {
      onFlowError(err, "enroll");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff(factorUid: string): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await unenrollTotpFactor(factorUid);
      refresh();
    } catch (err) {
      onFlowError(err, "unenroll");
    } finally {
      setBusy(false);
    }
  }

  async function confirmRecent(): Promise<void> {
    const next = pending;
    setBusy(true);
    setError("");
    try {
      await reauthenticateForMfa(password);
      setPassword("");
      setPending(null);
      if (next === "enroll") await startEnroll();
      else if (next === "unenroll" && factors[0]) await turnOff(factors[0].uid);
    } catch (err) {
      setError(messageFrom(err));
    } finally {
      setBusy(false);
    }
  }

  const method: ReauthMethod = pending ? reauthMethod() : "unsupported";
  const enrolled = factors[0];

  return (
    <div className="p-4 rounded-2xl glass-card" data-testid="two-factor-section">
      <p className="font-display text-sm text-white tracking-wide">Two-step verification</p>
      <p className="font-body text-xs text-faint mt-1 leading-snug">
        Use an authenticator app for a second code when you sign in.
      </p>

      {unavailable && (
        <p className="font-body text-sm text-muted mt-3" data-testid="two-factor-unavailable">
          Two-step verification isn&apos;t available yet.
        </p>
      )}

      {!unavailable && !setup && !pending && !enrolled && (
        <button
          type="button"
          onClick={() => void startEnroll()}
          disabled={busy}
          className="mt-3 inline-flex min-h-[44px] items-center justify-center rounded-full border border-brand-orange/30 bg-brand-orange/[0.12] px-4 font-display text-xs tracking-wider text-brand-orange disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          Set up authenticator app
        </button>
      )}

      {!unavailable && !setup && !pending && enrolled && (
        <div className="mt-3">
          <p className="font-body text-sm text-white">Authenticator app is on.</p>
          <button
            type="button"
            onClick={() => void turnOff(enrolled.uid)}
            disabled={busy}
            className="mt-2 inline-flex min-h-[44px] items-center justify-center rounded-full border border-border px-4 font-display text-xs tracking-wider text-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            Turn off
          </button>
        </div>
      )}

      {setup && (
        <div className="mt-3 space-y-3">
          {qrSrc ? (
            <img src={qrSrc} alt="QR code for your authenticator app" width={192} height={192} className="rounded-lg bg-white p-2" />
          ) : (
            <p className="font-body text-xs text-muted">Scan isn&apos;t available. Enter the key below instead.</p>
          )}
          <p className="font-body text-xs text-faint">Or enter this key manually:</p>
          <p className="font-mono text-sm text-white break-all" data-testid="totp-manual-key">
            {setup.secretKey}
          </p>
          <label className="block font-display text-[11px] tracking-[0.12em] text-dim" htmlFor="totp-code">
            AUTHENTICATOR CODE
          </label>
          <input
            id="totp-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="w-full bg-surface-alt/80 border border-border rounded-2xl text-white text-base font-body outline-none px-4 py-3 focus:border-brand-orange"
          />
          <button
            type="button"
            onClick={() => void finishEnroll()}
            disabled={busy}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-brand-orange px-4 font-display text-xs tracking-wider text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            Verify code
          </button>
        </div>
      )}

      {pending && (
        <div className="mt-3 space-y-3">
          <p className="font-body text-sm text-white">Confirm it&apos;s you to continue.</p>
          {method === "password" && (
            <input
              type="password"
              autoComplete="current-password"
              aria-label="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-surface-alt/80 border border-border rounded-2xl text-white text-base font-body outline-none px-4 py-3 focus:border-brand-orange"
            />
          )}
          {method === "unsupported" ? (
            <p className="font-body text-xs text-muted">Sign out and sign back in, then try again.</p>
          ) : (
            <button
              type="button"
              onClick={() => void confirmRecent()}
              disabled={busy}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-brand-orange px-4 font-display text-xs tracking-wider text-white disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
            >
              {method === "google" ? "Confirm with Google" : method === "apple" ? "Confirm with Apple" : "Confirm password"}
            </button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="font-body text-xs text-brand-red mt-3">
          {error}
        </p>
      )}
    </div>
  );
}
