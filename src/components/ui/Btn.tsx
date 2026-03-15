import type { ReactNode } from "react";

export function Btn({
  children,
  onClick,
  variant = "primary",
  disabled,
  className = "",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: string;
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "w-full rounded-xl font-display tracking-wider text-center transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
  const variants: Record<string, string> = {
    primary: "bg-brand-orange text-white py-4 text-xl",
    secondary: "bg-surface-alt border border-border text-white py-3.5 text-lg",
    success: "bg-brand-green text-black py-4 text-xl font-bold",
    danger: "bg-brand-red text-white py-4 text-xl",
    ghost: "bg-transparent border border-border text-[#888] py-3 text-lg",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant ?? "primary"]} ${className}`}
    >
      {children}
    </button>
  );
}
