import { useId } from "react";

const CONTROL_CLASSES =
  "min-h-[44px] w-full rounded-2xl border border-border bg-surface-alt/80 px-4 py-3 font-body text-base text-white outline-none transition-all duration-300 placeholder:text-subtle/60 focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1)] disabled:cursor-not-allowed disabled:opacity-40";

const LABEL_CLASSES = "mb-2 block font-display text-[11px] tracking-[0.2em] text-dim";

/**
 * Admin-only form primitives. The app's `ui/Field` is built for the signup /
 * profile flows (icons, async availability notes, error slots); these are the
 * stripped-down label + control pairs the console needs, sharing one set of
 * classes so every admin input lines up.
 */
export function AdminTextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  note,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  note?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="mb-3">
      <label htmlFor={id} className={LABEL_CLASSES}>
        {label.toUpperCase()}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={CONTROL_CLASSES}
      />
      {note && <span className="mt-1 block font-body text-xs text-faint">{note}</span>}
    </div>
  );
}

export function AdminSelectField({
  label,
  value,
  onChange,
  options,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly string[];
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="mb-3">
      <label htmlFor={id} className={LABEL_CLASSES}>
        {label.toUpperCase()}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className={`${CONTROL_CLASSES} appearance-none`}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
