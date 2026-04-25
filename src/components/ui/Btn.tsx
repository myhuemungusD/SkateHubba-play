import type { ReactNode } from "react";
import { hapticForVariant, playHaptic, type ButtonVariant } from "../../services/haptics";

export function Btn({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
  type = "button",
  autoFocus,
  /** Opt out of the per-variant haptic tap — use on low-intent repeating
   *  actions (nudge, carousel advance) where the buzz becomes noise. */
  haptic = true,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
  autoFocus?: boolean;
  haptic?: boolean;
}) {
  const base =
    "w-full rounded-2xl font-display tracking-wider text-center transition-all duration-300 ease-smooth disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
  const variants: Record<string, string> = {
    primary:
      "bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white py-4 text-xl shadow-[0_2px_12px_rgba(255,107,0,0.2),0_1px_2px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_28px_rgba(255,107,0,0.28),0_2px_6px_rgba(0,0,0,0.12)] hover:-translate-y-0.5 ring-1 ring-white/[0.08]",
    secondary: "glass-card text-white py-3.5 text-lg hover:-translate-y-0.5 hover:shadow-[0_8px_30px_rgba(0,0,0,0.2)]",
    success:
      "bg-gradient-to-r from-brand-green via-[#00D96E] to-[#00C864] text-black py-4 text-xl font-bold shadow-[0_2px_12px_rgba(0,230,118,0.2)] hover:shadow-[0_6px_28px_rgba(0,230,118,0.25)] hover:-translate-y-0.5 ring-1 ring-white/[0.08]",
    danger:
      "bg-gradient-to-r from-brand-red via-[#FF4A1A] to-[#FF5722] text-white py-4 text-xl shadow-[0_2px_12px_rgba(255,61,0,0.2)] hover:shadow-[0_6px_28px_rgba(255,61,0,0.25)] hover:-translate-y-0.5 ring-1 ring-white/[0.08]",
    ghost:
      "bg-transparent border border-border text-muted py-3 text-lg hover:border-border-hover hover:text-white hover:-translate-y-0.5 hover:shadow-[0_4px_16px_rgba(0,0,0,0.15)]",
  };
  const handleClick = () => {
    if (haptic) playHaptic(hapticForVariant(variant));
    onClick?.();
  };

  return (
    <button
      type={type}
      onClick={handleClick}
      disabled={disabled}
      autoFocus={autoFocus}
      className={`${base} ${variants[variant ?? "primary"]} ${className}`}
    >
      {children}
    </button>
  );
}
