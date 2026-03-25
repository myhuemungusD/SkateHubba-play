import { useId } from "react";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
  note,
  error,
  icon,
  autoComplete,
  autoFocus,
  disabled,
  autoCapitalize = "none",
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  note?: string;
  error?: string;
  icon?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  autoCapitalize?: string;
}) {
  const id = useId();
  const noteId = note ? `${id}-note` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className="mb-4 w-full">
      {label && (
        <label htmlFor={id} className="block font-display text-sm tracking-[0.12em] text-dim mb-2">
          {label}
        </label>
      )}
      <div className="relative group">
        {icon && (
          <span
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle text-base transition-colors duration-300 group-focus-within:text-brand-orange"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          autoCapitalize={autoCapitalize}
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={errorId ?? noteId}
          aria-invalid={error ? true : undefined}
          className={`w-full bg-surface-alt/80 backdrop-blur-sm border rounded-2xl text-white text-base font-body outline-none
            focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1),0_0_16px_rgba(255,107,0,0.06)] transition-all duration-300
            disabled:opacity-40 disabled:cursor-not-allowed
            placeholder:text-subtle/60
            ${error ? "border-brand-red" : "border-border"}
            ${icon ? "pl-10 pr-4 py-3.5" : "px-4 py-3.5"}`}
        />
      </div>
      {error && (
        <span id={errorId} className="text-xs text-brand-red mt-1.5 block font-body" role="alert">
          {error}
        </span>
      )}
      {note && !error && (
        <span id={noteId} className="text-xs text-faint mt-1.5 block font-body">
          {note}
        </span>
      )}
    </div>
  );
}
