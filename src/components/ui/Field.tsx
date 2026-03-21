import { useId } from "react";

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
  note,
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
  icon?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  autoCapitalize?: string;
}) {
  const id = useId();
  const noteId = note ? `${id}-note` : undefined;
  return (
    <div className="mb-4 w-full">
      {label && (
        <label htmlFor={id} className="block font-display text-sm tracking-[0.12em] text-dim mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-subtle text-base" aria-hidden="true">
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
          aria-describedby={noteId}
          className={`w-full bg-surface-alt/80 backdrop-blur-sm border border-border rounded-xl text-white text-base font-body outline-none
            focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1)] transition-all duration-300
            disabled:opacity-40 disabled:cursor-not-allowed
            ${icon ? "pl-10 pr-4 py-3.5" : "px-4 py-3.5"}`}
        />
      </div>
      {note && (
        <span id={noteId} className="text-xs text-faint mt-1 block">
          {note}
        </span>
      )}
    </div>
  );
}
