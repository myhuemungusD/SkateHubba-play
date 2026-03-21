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
  variant?: "primary" | "secondary" | "success" | "danger" | "ghost";
  disabled?: boolean;
  className?: string;
  type?: "button" | "submit";
}) {
  const base =
    "w-full rounded-xl font-display tracking-wider text-center transition-all duration-300 ease-smooth disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";
  const variants: Record<string, string> = {
    primary:
      "bg-gradient-to-r from-brand-orange to-[#FF8533] text-white py-4 text-xl shadow-glow-sm hover:shadow-glow-md hover:-translate-y-0.5",
    secondary: "glass-card text-white py-3.5 text-lg hover:-translate-y-0.5",
    success:
      "bg-gradient-to-r from-brand-green to-[#00C864] text-black py-4 text-xl font-bold shadow-glow-green hover:shadow-[0_0_40px_rgba(0,230,118,0.2)] hover:-translate-y-0.5",
    danger:
      "bg-gradient-to-r from-brand-red to-[#FF5722] text-white py-4 text-xl shadow-glow-red hover:shadow-[0_0_40px_rgba(255,61,0,0.2)] hover:-translate-y-0.5",
    ghost:
      "bg-transparent border border-border text-muted py-3 text-lg hover:border-border-hover hover:text-white hover:-translate-y-0.5",
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
