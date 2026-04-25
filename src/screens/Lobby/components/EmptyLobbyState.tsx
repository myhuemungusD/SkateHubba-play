interface Props {
  emailVerified: boolean;
  onChallenge: () => void;
}

export function EmptyLobbyState({ emailVerified, onChallenge }: Props) {
  return (
    <div className="flex flex-col items-center py-12 px-6 border border-dashed border-white/[0.06] rounded-2xl mb-6 bg-surface/30 backdrop-blur-sm text-center">
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
      <h2 className="font-display text-xl text-white tracking-wide">Ready to S.K.A.T.E.?</h2>
      <p className="font-body text-xs text-faint mt-2 max-w-[16rem]">
        Pick an opponent, record a trick, and call them out. First to spell S-K-A-T-E loses.
      </p>
      {emailVerified ? (
        <button
          type="button"
          onClick={onChallenge}
          className="mt-5 min-h-[44px] inline-flex items-center gap-2 rounded-xl px-5 font-display text-sm tracking-wider bg-brand-orange/10 border border-brand-orange/30 text-brand-orange hover:bg-brand-orange/15 hover:border-brand-orange/50 transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          Challenge your first opponent →
        </button>
      ) : (
        <p className="mt-4 font-body text-[11px] text-subtle">Verify your email to start a game</p>
      )}
    </div>
  );
}
