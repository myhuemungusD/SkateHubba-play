interface Props {
  emailVerified: boolean;
  onChallenge: () => void;
  /** True when the skater has finished games but none in progress. */
  returning?: boolean;
}

export function EmptyLobbyState({ emailVerified, onChallenge, returning = false }: Props) {
  return (
    <div className="flex flex-col items-center py-12 px-6 border border-white/[0.06] rounded-2xl mb-6 bg-surface shadow-card text-center">
      <svg
        className="text-brand-orange mb-4"
        data-testid="empty-lobby-deck"
        width="38"
        height="38"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {/* Skateboard, side view: kicked nose and tail, two trucks, four
            wheels (two visible). Same line weight as the rest of the card. */}
        <path d="M2.5 9.5c.6 1.6 1.7 2.5 3.4 2.5h12.2c1.7 0 2.8-.9 3.4-2.5" />
        <path d="M7 12v2.25M17 12v2.25M5.5 14.25h3M15.5 14.25h3" />
        <circle cx="7" cy="16.75" r="1.75" />
        <circle cx="17" cy="16.75" r="1.75" />
      </svg>
      <h2 className="font-display text-xl text-white tracking-wide">
        {returning ? "No games going" : "Ready to S.K.A.T.E.?"}
      </h2>
      <p className="font-body text-xs text-faint mt-2 max-w-[16rem]">
        {returning
          ? "Start a new game of S.K.A.T.E. and call someone out."
          : "Pick an opponent, record a trick, and call them out. First to spell S-K-A-T-E loses."}
      </p>
      {emailVerified ? (
        <button
          type="button"
          onClick={onChallenge}
          className="mt-5 min-h-[44px] inline-flex items-center gap-2 rounded-xl px-5 font-display text-sm tracking-wider bg-brand-orange border border-brand-orange text-white hover:bg-brand-orange/90 transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          {returning ? "Start a game →" : "Challenge your first opponent →"}
        </button>
      ) : (
        <p className="mt-4 font-body text-[11px] text-subtle">Verify your email to start a game</p>
      )}
    </div>
  );
}
