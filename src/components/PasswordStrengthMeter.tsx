/**
 * Three-segment password-strength meter shown under the password field during
 * email signup. Presentational only — it maps the numeric strength score from
 * `pwStrength` (src/utils/helpers.ts) to bar fills + a label. Renders nothing
 * for an empty password so the caller can mount it unconditionally.
 */

import { pwStrength } from "../utils/helpers";

const LABELS: Record<1 | 2 | 3, string> = { 1: "Weak", 2: "Fair", 3: "Strong" };
const COLORS: Record<1 | 2 | 3, string> = {
  1: "bg-brand-red",
  2: "bg-yellow-500",
  3: "bg-brand-green",
};

export function PasswordStrengthMeter({ password }: { password: string }) {
  if (password.length === 0) return null;
  const strength = pwStrength(password);
  return (
    <div
      className="flex items-center gap-2 -mt-2 mb-4"
      role="status"
      aria-label={`Password strength: ${LABELS[strength]}`}
    >
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
      <span className={`font-body text-[10px] ${COLORS[strength].replace("bg-", "text-")}`}>{LABELS[strength]}</span>
    </div>
  );
}
