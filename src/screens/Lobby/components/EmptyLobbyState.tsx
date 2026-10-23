interface Props {
  emailVerified: boolean;
  onChallenge: () => void;
  /** True when the skater has finished games but none in progress. */
  returning?: boolean;
}

/**
 * Small hint where the games queue would be when nothing is in progress. Home
 * leads with skater search now, so this stays one compact row rather than the
 * big card it replaced.
 */
export function EmptyLobbyState({ emailVerified, onChallenge, returning = false }: Props) {
  return (
    <div
      className="mb-6 flex items-center gap-3 rounded-xl border border-dashed border-white/[0.1] px-4 py-3"
      data-testid="empty-lobby-hint"
    >
      <svg
        className="shrink-0 text-brand-orange"
        data-testid="empty-lobby-deck"
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* Skateboard, side view: kicked nose and tail, two trucks, two wheels. */}
        <path d="M2.5 9.5c.6 1.6 1.7 2.5 3.4 2.5h12.2c1.7 0 2.8-.9 3.4-2.5" />
        <path d="M7 12v2.25M17 12v2.25M5.5 14.25h3M15.5 14.25h3" />
        <circle cx="7" cy="16.75" r="1.75" />
        <circle cx="17" cy="16.75" r="1.75" />
      </svg>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-sm tracking-wide text-white">
          {returning ? "No games going" : "Ready to S.K.A.T.E.?"}
        </h2>
        <p className="mt-0.5 font-body text-[11px] text-faint">
          {emailVerified ? "Search a skater above or start one here." : "Verify your email to start a game"}
        </p>
      </div>
      {emailVerified && (
        <button
          type="button"
          onClick={onChallenge}
          className="min-h-[44px] shrink-0 rounded-lg px-2 font-display text-xs tracking-wider text-brand-orange hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          {returning ? "Start a game →" : "Challenge your first opponent →"}
        </button>
      )}
    </div>
  );
}
