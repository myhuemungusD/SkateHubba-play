interface ProUsernameProps {
  username: string;
  isVerifiedPro?: boolean;
  /** Additional Tailwind classes applied to the outer span. */
  className?: string;
}

export function ProUsername({ username, isVerifiedPro, className = "" }: ProUsernameProps) {
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
