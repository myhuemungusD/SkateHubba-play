import { isExtrasEnabled } from "../lib/featureFlags";

interface ProUsernameProps {
  username: string;
  isVerifiedPro?: boolean;
  /** Additional Tailwind classes applied to the outer span. */
  className?: string;
}

export function ProUsername({ username, isVerifiedPro: rawIsVerifiedPro, className = "" }: ProUsernameProps) {
  // Verified Pro is frozen behind VITE_FEATURE_EXTRAS_ENABLED (default OFF):
  // while frozen the gold shimmer + ✦ badge are suppressed app-wide. The
  // `isVerifiedPro` data itself is untouched — see src/lib/featureFlags.ts.
  const isVerifiedPro = rawIsVerifiedPro === true && isExtrasEnabled();
  return (
    <span className={`${className} ${isVerifiedPro ? "pro-username" : ""}`}>
      @{username}
      {isVerifiedPro && (
        <span className="pro-username ml-1 text-[0.65em]" title="Verified Pro">
          ✦
        </span>
      )}
    </span>
  );
}
