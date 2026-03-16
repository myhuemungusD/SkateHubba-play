import { BG } from "../utils/helpers";
import { Btn } from "../components/ui/Btn";
import { GoogleButton } from "../components/GoogleButton";
import { InviteButton } from "../components/InviteButton";

function SkateboardIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="64"
      height="64"
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Deck */}
      <rect x="8" y="26" width="48" height="8" rx="4" fill="#FF6B00" />
      {/* Grip tape stripe */}
      <rect x="12" y="28" width="40" height="4" rx="2" fill="#CC5500" opacity="0.5" />
      {/* Left truck */}
      <rect x="14" y="34" width="8" height="3" rx="1" fill="#888" />
      {/* Right truck */}
      <rect x="42" y="34" width="8" height="3" rx="1" fill="#888" />
      {/* Left wheels */}
      <circle cx="16" cy="41" r="4" fill="#444" />
      <circle cx="16" cy="41" r="2" fill="#666" />
      <circle cx="24" cy="41" r="4" fill="#444" />
      <circle cx="24" cy="41" r="2" fill="#666" />
      {/* Right wheels */}
      <circle cx="40" cy="41" r="4" fill="#444" />
      <circle cx="40" cy="41" r="2" fill="#666" />
      <circle cx="48" cy="41" r="4" fill="#444" />
      <circle cx="48" cy="41" r="2" fill="#666" />
    </svg>
  );
}

const HOW_IT_WORKS = [
  { step: "1", label: "Set a trick", desc: "Film your trick in one take and challenge an opponent." },
  { step: "2", label: "Opponent matches", desc: "They have 24hrs to land your trick or set one back." },
  { step: "3", label: "Earn letters", desc: "Miss a trick, get a letter. S-K-A-T-E spells defeat." },
] as const;

export function Landing({
  onGo,
  onGoogle,
  googleLoading,
  onNav,
}: {
  onGo: (mode: "signup" | "signin") => void;
  onGoogle: () => void;
  googleLoading: boolean;
  onNav: (screen: "privacy" | "terms") => void;
}) {
  return (
    <main
      className="min-h-dvh flex flex-col items-center justify-center px-6"
      style={{ background: `radial-gradient(ellipse at 50% 0%, rgba(255,107,0,0.06) 0%, transparent 60%), ${BG}` }}
    >
      <SkateboardIcon className="animate-board-roll mb-4" />
      <span className="font-display text-lg tracking-[0.35em] text-brand-orange mb-2">SKATEHUBBA™</span>
      <h1 className="font-display text-[clamp(56px,12vw,88px)] text-white leading-[0.95] text-center">S.K.A.T.E.</h1>
      <p className="font-body text-base text-[#888] text-center max-w-xs mt-4 mb-10 leading-relaxed">
        The first async trick battle game.
        <br />
        Set tricks. Match tricks. One take only.
      </p>
      <div className="w-full max-w-xs flex flex-col gap-3">
        <GoogleButton onClick={onGoogle} loading={googleLoading} />
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-border" />
          <span className="font-body text-xs text-[#444]">or</span>
          <div className="flex-1 h-px bg-border" />
        </div>
        <Btn onClick={() => onGo("signup")} disabled={googleLoading}>
          Get Started with Email
        </Btn>
        <Btn onClick={() => onGo("signin")} variant="ghost" disabled={googleLoading}>
          I Have an Account
        </Btn>
        <InviteButton className="mt-2" />
      </div>

      {/* How it works */}
      <section className="w-full max-w-sm mt-14 animate-fade-in" aria-label="How it works">
        <h2 className="font-display text-xl text-white text-center tracking-wider mb-6">HOW IT WORKS</h2>
        <ol className="flex flex-col gap-4 list-none p-0 m-0">
          {HOW_IT_WORKS.map((item) => (
            <li key={item.step} className="flex items-start gap-4 px-4 py-3 rounded-xl bg-surface border border-border">
              <span className="font-display text-2xl text-brand-orange leading-none mt-0.5">{item.step}</span>
              <div>
                <span className="font-display text-base text-white tracking-wide">{item.label}</span>
                <p className="font-body text-xs text-[#666] mt-0.5 leading-relaxed">{item.desc}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <ul className="flex gap-5 mt-10 flex-wrap justify-center list-none p-0 m-0" aria-label="Key features">
        {[
          { icon: "📹", text: "One-take video" },
          { icon: "⏱", text: "24hr turns" },
          { icon: "🔥", text: "No trick-farming" },
        ].map((f) => (
          <li key={f.text} className="flex items-center gap-2 px-4 py-2 rounded-lg border border-border">
            <span className="text-base" aria-hidden="true">
              {f.icon}
            </span>
            <span className="font-body text-xs text-[#555]">{f.text}</span>
          </li>
        ))}
      </ul>

      <nav className="mt-10 flex gap-5 flex-wrap justify-center" aria-label="Legal">
        <button
          type="button"
          onClick={() => onNav("privacy")}
          className="font-body text-xs text-[#555] hover:text-[#888] transition-colors"
        >
          Privacy Policy
        </button>
        <button
          type="button"
          onClick={() => onNav("terms")}
          className="font-body text-xs text-[#555] hover:text-[#888] transition-colors"
        >
          Terms of Service
        </button>
      </nav>
    </main>
  );
}
