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
        <circle cx="7.5" cy="17.5" r="2.5" />
        <circle cx="17.5" cy="17.5" r="2.5" />
        <path d="M2 7h1.5l2.1 7.5h10.8l2.1-6H7.5" />
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
