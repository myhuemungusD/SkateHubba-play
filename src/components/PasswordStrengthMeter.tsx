/**
 * Three-segment password-strength meter shown under the password field during
 * email signup. Presentational only — it maps the numeric strength score from
 * `passwordStrength` (src/utils/passwordPolicy.ts) to bar fills + a label. Renders nothing
 * for an empty password so the caller can mount it unconditionally.
 */

import {
  MIRRORED_PASSWORD_POLICY,
  passwordMeterLabel,
  passwordStrength,
  type SignupPasswordPolicy,
} from "../utils/passwordPolicy";

const COLORS: Record<1 | 2 | 3, string> = {
  1: "bg-brand-red",
  2: "bg-yellow-500",
  3: "bg-brand-green",
};
// Parallel text-color map. Spelled out as literal classes (rather than
// deriving from COLORS via string replace) so Tailwind's static scanner
// actually emits them, and so a bg token without a 1:1 text counterpart
// can't silently break.
const TEXT_COLORS: Record<1 | 2 | 3, string> = {
  1: "text-brand-red",
  2: "text-yellow-500",
  3: "text-brand-green",
};

export function PasswordStrengthMeter({
  password,
  policy = MIRRORED_PASSWORD_POLICY,
}: {
  password: string;
  policy?: SignupPasswordPolicy;
}) {
  if (password.length === 0) return null;
  const strength = passwordStrength(password, policy);
  const label = passwordMeterLabel(password, policy);
  return (
    <div className="flex items-center gap-2 -mt-2 mb-4" role="status" aria-label={`Password strength: ${label}`}>
      <div className="flex gap-1 flex-1" aria-hidden="true">
        {([1, 2, 3] as const).map((lvl) => (
          <div
            key={lvl}
            className={`h-0.5 flex-1 rounded-full transition-colors duration-300 ${
              strength >= lvl ? COLORS[strength] : "bg-surface-alt"
            }`}
          />
        ))}
      </div>
      <span className={`font-body text-[10px] ${TEXT_COLORS[strength]}`}>{label}</span>
    </div>
  );
}
