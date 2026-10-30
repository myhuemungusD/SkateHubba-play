import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useGoBack } from "../hooks/useGoBack";

interface BackButtonProps {
  /** Where Back goes when there's no in-app history (deep link, refresh). */
  fallback: string;
  label?: string;
  /** Screens that own their exit (Settings closes back to the lobby) pass it here. */
  onBack?: () => void;
}

/**
 * The one back button. 44×44pt, top-left, same spot on every pushed screen
 * (the Instagram / Strava pattern: chevron left, title beside it).
 */
function BackButton({ fallback, label = "Back", onBack }: BackButtonProps) {
  const goBack = useGoBack(fallback);
  return <BackChevron onClick={onBack ?? goBack} label={label} />;
}

/**
 * The back button's look without the router: for surfaces that can render
 * outside it (the legal pages, the boot shell) and own their own exit.
 */
export function BackChevron({ onClick, label = "Back" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      data-testid="screen-back"
      className="-ml-2 inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center rounded-full text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-brand-orange"
    >
      <ChevronLeft size={26} aria-hidden="true" />
    </button>
  );
}

interface ScreenHeaderProps extends BackButtonProps {
  title: string;
  right?: ReactNode;
}

export function ScreenHeader({ fallback, label, onBack, title, right }: ScreenHeaderProps) {
  return (
    <header className="flex min-h-11 items-center gap-1">
      <BackButton fallback={fallback} label={label} onBack={onBack} />
      <h1 className="flex-1 truncate font-display text-3xl tracking-wider text-white">{title}</h1>
      {right}
    </header>
  );
}
