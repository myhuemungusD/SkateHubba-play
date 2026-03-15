import { BG } from "../utils/helpers";
import { Btn } from "../components/ui/Btn";
import { GoogleButton } from "../components/GoogleButton";
import { InviteButton } from "../components/InviteButton";

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
      <ul className="flex gap-5 mt-12 flex-wrap justify-center list-none p-0 m-0" aria-label="Key features">
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
