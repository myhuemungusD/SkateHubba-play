/**
 * SMS (phone) two-step verification control for Settings.
 *
 * Email/password users can enroll a phone number as a second factor.
 * Enrollment sends an SMS code, then confirms with the 6-digit code.
 * Firebase requires a recent sign-in; failure opens a re-auth step.
 *
 * Only shown when:
 * - Feature flag VITE_FEATURE_SMS_2FA_ENABLED is on
 * - User signed in with email/password (not Google/Apple)
 *
 * NOTE: Web-only for now. Native (iOS/Android) reCAPTCHA doesn't work on
 * capacitor://localhost, so SMS enrollment is blocked on native until we
 * add a custom-token serverless endpoint or Cloud Function.
 */
import { useState, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import {
  beginSmsEnrollment,
  confirmSmsEnrollment,
  getPhoneNumber,
  hasPasswordSignIn,
  listSmsFactors,
  MFA_UNAVAILABLE,
  reauthMethod,
  reauthenticateForMfa,
  unenrollSmsFactor,
} from "../services/mfa.enroll";
import { getErrorCode } from "../utils/errors";
import { Phone, AlertCircle } from "lucide-react";
import { Btn } from "./ui/Btn";

type Pending = "enroll" | "unenroll";

function messageFrom(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong. Try again.";
}

export function SmsTwoFactorSection() {
  const [factors, setFactors] = useState(() => listSmsFactors());
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const recaptchaRef = useRef<HTMLDivElement>(null);

  // Only show to email/password users
  const passwordAuth = hasPasswordSignIn();
  const method = reauthMethod();

  if (!passwordAuth) {
    return null;
  }

  if (Capacitor.isNativePlatform()) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Phone size={18} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Text Message Codes</h3>
        </div>
        <p className="text-xs text-slate-400">
          SMS two-step verification is not available in the app yet. Use the website to set it up.
        </p>
      </div>
    );
  }

  if (unavailable) {
    return (
      <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Phone size={18} className="text-blue-400" />
          <h3 className="text-sm font-semibold text-white">Text Message Codes</h3>
        </div>
        <p className="text-xs text-slate-400">SMS two-step verification isn't available yet.</p>
      </div>
    );
  }

  const enrolled = factors.length > 0;

  const handleStartEnroll = async () => {
    if (!phoneNumber.trim()) {
      setError("Enter your phone number");
      return;
    }

    setBusy(true);
    setError("");
    setPending("enroll");

    try {
      const vid = await beginSmsEnrollment(phoneNumber, recaptchaRef.current!);
      setVerificationId(vid);
    } catch (err: unknown) {
      if (getErrorCode(err) === MFA_UNAVAILABLE) {
        setUnavailable(true);
        return;
      }
      if (getErrorCode(err) === "auth/requires-recent-login") {
        // Re-auth required, will retry after password entry
        setError(messageFrom(err));
      } else {
        setError(messageFrom(err));
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmEnroll = async () => {
    if (!verificationId || !code.trim()) {
      setError("Enter the 6-digit code");
      return;
    }

    setBusy(true);
    setError("");

    try {
      await confirmSmsEnrollment(verificationId, code);
      setFactors(listSmsFactors());
      setPending(null);
      setVerificationId(null);
      setCode("");
      setPhoneNumber("");
      setPassword("");
    } catch (err: unknown) {
      setError(messageFrom(err));
    } finally {
      setBusy(false);
    }
  };

  const handleUnenroll = async (factorUid: string) => {
    setBusy(true);
    setError("");
    setPending("unenroll");

    try {
      await unenrollSmsFactor(factorUid);
      setFactors(listSmsFactors());
      setPending(null);
      setPassword("");
    } catch (err: unknown) {
      if (getErrorCode(err) === "auth/requires-recent-login") {
        setError(messageFrom(err));
      } else {
        setError(messageFrom(err));
        setPending(null);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleReauth = async () => {
    if (method === "password" && !password.trim()) {
      setError("Enter your password");
      return;
    }

    setBusy(true);
    setError("");

    try {
      await reauthenticateForMfa(password);
      // Retry the pending action
      if (pending === "enroll" && phoneNumber) {
        const vid = await beginSmsEnrollment(phoneNumber, recaptchaRef.current!);
        setVerificationId(vid);
        setPassword("");
      } else if (pending === "unenroll" && factors[0]) {
        await unenrollSmsFactor(factors[0].uid);
        setFactors(listSmsFactors());
        setPending(null);
        setPassword("");
      }
    } catch (err: unknown) {
      setError(messageFrom(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = () => {
    setPending(null);
    setVerificationId(null);
    setCode("");
    setPhoneNumber("");
    setPassword("");
    setError("");
  };

  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Phone size={18} className="text-blue-400" />
        <h3 className="text-sm font-semibold text-white">Text Message Codes</h3>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg bg-red-900/20 p-3">
          <AlertCircle size={16} className="mt-0.5 flex-shrink-0 text-red-400" />
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {enrolled && !pending ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Two-step verification is on. You'll need your phone when you sign in.
          </p>
          {factors.map((factor) => (
            <div key={factor.uid} className="flex items-center justify-between">
              <span className="text-sm text-white">{getPhoneNumber(factor) || "Phone"}</span>
              <Btn onClick={() => handleUnenroll(factor.uid)} disabled={busy} variant="secondary" size="sm">
                Remove
              </Btn>
            </div>
          ))}
        </div>
      ) : null}

      {!enrolled && !pending ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">
            Get codes sent to your phone when you sign in. More secure than password alone.
          </p>
          <Btn onClick={() => setPending("enroll")} variant="primary" size="sm">
            Set up text codes
          </Btn>
        </div>
      ) : null}

      {pending === "enroll" && !verificationId ? (
        <div className="space-y-3">
          {getErrorCode(error) === "auth/requires-recent-login" ? (
            <>
              <p className="text-xs text-slate-400">Confirm it's you to continue.</p>
              {method === "password" && (
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Your password"
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-400"
                />
              )}
              <div className="flex gap-2">
                <Btn onClick={handleReauth} disabled={busy} variant="primary" size="sm">
                  {method === "password" ? "Confirm" : "Re-authenticate"}
                </Btn>
                <Btn onClick={handleCancel} disabled={busy} variant="secondary" size="sm">
                  Cancel
                </Btn>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs text-slate-400">Enter your phone number to receive a code.</p>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1234567890"
                className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-400"
              />
              <div ref={recaptchaRef} />
              <div className="flex gap-2">
                <Btn onClick={handleStartEnroll} disabled={busy} variant="primary" size="sm">
                  Send code
                </Btn>
                <Btn onClick={handleCancel} disabled={busy} variant="secondary" size="sm">
                  Cancel
                </Btn>
              </div>
            </>
          )}
        </div>
      ) : null}

      {pending === "enroll" && verificationId ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Enter the 6-digit code sent to {phoneNumber}</p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="123456"
            className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-center text-lg tracking-widest text-white"
          />
          <div className="flex gap-2">
            <Btn onClick={handleConfirmEnroll} disabled={busy || code.length !== 6} variant="primary" size="sm">
              Verify
            </Btn>
            <Btn onClick={handleCancel} disabled={busy} variant="secondary" size="sm">
              Cancel
            </Btn>
          </div>
        </div>
      ) : null}

      {pending === "unenroll" && getErrorCode(error) === "auth/requires-recent-login" ? (
        <div className="space-y-3">
          <p className="text-xs text-slate-400">Confirm it's you to remove SMS verification.</p>
          {method === "password" && (
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your password"
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-400"
            />
          )}
          <div className="flex gap-2">
            <Btn onClick={handleReauth} disabled={busy} variant="primary" size="sm">
              {method === "password" ? "Confirm" : "Re-authenticate"}
            </Btn>
            <Btn onClick={handleCancel} disabled={busy} variant="secondary" size="sm">
              Cancel
            </Btn>
          </div>
        </div>
      ) : null}
    </div>
  );
}
