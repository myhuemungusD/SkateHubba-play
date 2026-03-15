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
}) {
  const id = useId();
  return (
    <div className="mb-4 w-full">
      {label && (
        <label htmlFor={id} className="block font-display text-sm tracking-[0.12em] text-[#999] mb-1.5">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#555] text-base" aria-hidden="true">
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
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`w-full bg-surface-alt border border-border rounded-xl text-white text-base font-body outline-none
            focus:border-brand-orange transition-colors duration-200
            ${icon ? "pl-10 pr-4 py-3.5" : "px-4 py-3.5"}`}
        />
      </div>
      {note && <span className="text-xs text-[#777] mt-1 block">{note}</span>}
    </div>
  );
}
