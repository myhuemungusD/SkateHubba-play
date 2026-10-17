/**
 * Re-authentication UI for SMS 2FA enrollment/unenrollment.
 *
 * Firebase requires recent sign-in to change MFA settings. This component
 * handles the password prompt for email/password users or delegates to
 * OAuth flows for Google/Apple.
 */
import { Btn } from "./ui/Btn";
import type { ReauthMethod } from "../services/mfa.enroll";

interface ReauthPromptProps {
  method: ReauthMethod;
  password: string;
  onPasswordChange: (value: string) => void;
  onReauth: () => void;
  onCancel: () => void;
  busy: boolean;
}

export function ReauthPrompt({ method, password, onPasswordChange, onReauth, onCancel, busy }: ReauthPromptProps) {
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Confirm it's you to continue.</p>
      {method === "password" && (
        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder="Your password"
          className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white placeholder-slate-400"
        />
      )}
      <div className="flex gap-2">
        <Btn onClick={onReauth} disabled={busy} variant="primary">
          {method === "password" ? "Confirm" : "Re-authenticate"}
        </Btn>
        <Btn onClick={onCancel} disabled={busy} variant="secondary">
          Cancel
        </Btn>
      </div>
    </div>
  );
}
