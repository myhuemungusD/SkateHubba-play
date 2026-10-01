/**
 * Three-input date-of-birth row: MM / DD / YYYY with numeric inputMode,
 * digit sanitization, and accessible labels. Shared between AuthScreen
 * (email signup) and ProfileSetup (Google signup fallback) so the two
 * collection surfaces can't drift.
 *
 * Validation lives in `src/utils/age.ts` — this component only captures
 * three strings. Callers feed them into `parseDob()` to get a typed result.
 *
 * Auto-advance: typing the 2nd digit of MM or DD moves focus to the next box
 * so the whole date can be entered as one number-pad run. It only fires when
 * the value grows to full length (never on delete/edit), and never skips
 * backwards, so correcting a box works as before.
 */

import { useRef, type ChangeEvent, type RefObject } from "react";

const INPUT_CLASS =
  "w-full bg-surface-alt/80 backdrop-blur-sm border border-border rounded-2xl text-white text-base font-body outline-none focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1),0_0_16px_rgba(255,107,0,0.06)] transition-all duration-300 px-4 py-3.5 text-center disabled:opacity-40 disabled:cursor-not-allowed";

export type DobField = "month" | "day" | "year";

export function DobRow({
  month,
  day,
  year,
  onChange,
  disabled,
}: {
  month: string;
  day: string;
  year: string;
  onChange: (field: DobField, value: string) => void;
  disabled?: boolean;
}) {
  const dayRef = useRef<HTMLInputElement>(null);
  const yearRef = useRef<HTMLInputElement>(null);

  const handle = (
    e: ChangeEvent<HTMLInputElement>,
    field: DobField,
    prev: string,
    next?: RefObject<HTMLInputElement | null>,
  ) => {
    const value = e.target.value.replace(/\D/g, "");
    onChange(field, value);
    if (next && value.length === 2 && value.length > prev.length) next.current?.focus();
  };

  return (
    <div className="flex gap-3 mb-2">
      <div className="flex-1">
        <input
          type="text"
          inputMode="numeric"
          placeholder="MM"
          maxLength={2}
          value={month}
          disabled={disabled}
          onChange={(e) => handle(e, "month", month, dayRef)}
          className={INPUT_CLASS}
          aria-label="Birth month"
        />
      </div>
      <div className="flex-1">
        <input
          ref={dayRef}
          type="text"
          inputMode="numeric"
          placeholder="DD"
          maxLength={2}
          value={day}
          disabled={disabled}
          onChange={(e) => handle(e, "day", day, yearRef)}
          className={INPUT_CLASS}
          aria-label="Birth day"
        />
      </div>
      <div className="flex-[1.5]">
        <input
          ref={yearRef}
          type="text"
          inputMode="numeric"
          placeholder="YYYY"
          maxLength={4}
          value={year}
          disabled={disabled}
          onChange={(e) => handle(e, "year", year)}
          className={INPUT_CLASS}
          aria-label="Birth year"
        />
      </div>
    </div>
  );
}
