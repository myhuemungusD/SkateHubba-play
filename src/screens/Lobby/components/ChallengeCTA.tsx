import { InviteButton } from "../../../components/InviteButton";

interface Props {
  emailVerified: boolean;
  username: string;
  onChallenge: () => void;
  onChallengeUser: (username: string) => void;
}

export function ChallengeCTA({ emailVerified, username, onChallenge, onChallengeUser }: Props) {
  return (
    <>
      <button
        type="button"
        data-tutorial="challenge-cta"
        onClick={emailVerified ? onChallenge : undefined}
        disabled={!emailVerified}
        className={`w-full flex items-center justify-center gap-2.5 rounded-2xl py-4 mb-1 font-display tracking-wider text-xl transition-all duration-300 ease-smooth focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange ${emailVerified ? "bg-gradient-to-r from-brand-orange via-[#FF7A1A] to-[#FF8533] text-white active:scale-[0.97] hover:-translate-y-0.5 shadow-[0_2px_12px_rgba(255,107,0,0.2),0_1px_2px_rgba(0,0,0,0.1)] hover:shadow-[0_6px_28px_rgba(255,107,0,0.28),0_2px_6px_rgba(0,0,0,0.12)] ring-1 ring-white/[0.08]" : "bg-brand-orange/25 text-white/75 cursor-not-allowed border border-brand-orange/20"}`}
      >
        <svg
          width="17"
          height="17"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="3" />
          <line x1="12" y1="2" x2="12" y2="4.5" />
          <line x1="12" y1="19.5" x2="12" y2="22" />
          <line x1="2" y1="12" x2="4.5" y2="12" />
          <line x1="19.5" y1="12" x2="22" y2="12" />
        </svg>
        Challenge Someone
      </button>
      {!emailVerified && (
        <p className="text-[11px] text-muted text-center mb-2 font-body">Verify your email to start challenging</p>
      )}

      <InviteButton username={username} className="mb-3" />

      {emailVerified && (
        <p className="font-body text-xs text-dim text-center mb-8">
          No one to play?{" "}
          <button
            type="button"
            onClick={() => onChallengeUser("mikewhite")}
            className="min-h-[44px] inline-flex items-center justify-center px-2 -mx-2 rounded-md text-brand-orange hover:text-[#FF7A1A] hover:bg-brand-orange/5 transition-colors underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            Challenge @mikewhite
          </button>
        </p>
      )}
    </>
  );
}
