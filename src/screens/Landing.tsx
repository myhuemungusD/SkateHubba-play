import { Btn } from "../components/ui/Btn";
import { GoogleButton } from "../components/GoogleButton";
import { InviteButton } from "../components/InviteButton";
import { VideoIcon, ClockIcon, FlameIcon, ShieldIcon, TrophyIcon, UsersIcon } from "../components/icons";

/* ── Data ────────────────────────────────────────────────── */

const BRAND_ICON_CLASS = "text-brand-orange";

const HOW_IT_WORKS = [
  {
    step: "01",
    label: "Set a Trick",
    desc: "Film yourself landing a trick in one continuous take. No edits, no retakes — raw skill only.",
    color: "#FF6B00",
  },
  {
    step: "02",
    label: "Challenge an Opponent",
    desc: "Send the challenge. Your opponent has 24 hours to match your trick or set one back.",
    color: "#FF8533",
  },
  {
    step: "03",
    label: "Earn Letters",
    desc: "Miss a trick, earn a letter. S-K-A-T-E spells game over. Last one standing wins.",
    color: "#FFA366",
  },
] as const;

const FEATURES = [
  {
    icon: <VideoIcon size={28} className={BRAND_ICON_CLASS} />,
    title: "One-Take Video",
    desc: "No editing. No second chances. Film your trick in one continuous take to keep it real.",
  },
  {
    icon: <ClockIcon size={28} className={BRAND_ICON_CLASS} />,
    title: "24hr Async Turns",
    desc: "Play on your schedule. Each player gets a full day to film and submit their trick.",
  },
  {
    icon: <FlameIcon size={28} className={BRAND_ICON_CLASS} />,
    title: "No Trick Farming",
    desc: "Every trick counts. No spamming easy tricks — the game rewards creativity and skill.",
  },
  {
    icon: <ShieldIcon size={28} className={BRAND_ICON_CLASS} />,
    title: "Fair Play",
    desc: "One take only means what you see is what you get. No room for faking it.",
  },
  {
    icon: <TrophyIcon size={28} className={BRAND_ICON_CLASS} />,
    title: "Competitive Rankings",
    desc: "Build your reputation. Win games, climb the leaderboard, become the GOAT.",
  },
  {
    icon: <UsersIcon size={28} className={BRAND_ICON_CLASS} />,
    title: "Challenge Anyone",
    desc: "Invite your crew or battle strangers. All you need is a board and a phone.",
  },
] as const;

/* ── Component ───────────────────────────────────────────── */

export function Landing({
  onGo,
  onGoogle,
  googleLoading,
  onNav,
}: {
  onGo: (mode: "signup" | "signin") => void;
  onGoogle: () => void;
  googleLoading: boolean;
  onNav: (screen: "privacy" | "terms" | "datadeletion") => void;
}) {
  return (
    <div className="min-h-dvh pb-28 md:pb-0">
      {/* ─── Sticky Nav Bar ─────────────────────────────── */}
      <nav className="sticky top-0 z-50 glass border-b border-white/[0.04]">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="font-display text-lg tracking-[0.25em] text-brand-orange">
            SKATEHUBBA<span className="text-subtle">™</span>
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onGo("signin")}
              className="font-display text-sm tracking-wider text-muted hover:text-white transition-colors duration-300"
            >
              LOG IN
            </button>
            <button
              type="button"
              onClick={() => onGo("signup")}
              className="font-display text-sm tracking-wider bg-gradient-to-r from-brand-orange to-[#FF8533] text-white px-5 py-2 rounded-lg shadow-glow-sm hover:shadow-glow-md hover:-translate-y-0.5 transition-all duration-300 active:scale-[0.97]"
            >
              SIGN UP
            </button>
          </div>
        </div>
      </nav>

      {/* ─── Hero Section ───────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Animated mesh gradient background */}
        <div
          className="absolute inset-0 pointer-events-none animate-gradient"
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255,107,0,0.1) 0%, transparent 60%), radial-gradient(ellipse 60% 40% at 80% 20%, rgba(255,61,0,0.05) 0%, transparent 50%), radial-gradient(ellipse 50% 30% at 20% 40%, rgba(255,133,51,0.04) 0%, transparent 50%)",
            backgroundSize: "200% 200%",
          }}
        />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,107,0,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(255,107,0,0.3) 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative max-w-5xl mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28 flex flex-col items-center text-center">
          <img
            src="/logonew.webp"
            alt="SkateHubba"
            width={1536}
            height={1024}
            draggable={false}
            className="w-80 md:w-[28rem] lg:w-[32rem] mb-6 drop-shadow-[0_0_60px_rgba(255,107,0,0.25)] select-none"
          />
          <p className="font-body text-fluid-lg text-muted max-w-md leading-relaxed mb-4">
            The first async trick battle game.
            <br />
            <span className="text-white font-medium">Set tricks. Match tricks. One take only.</span>
          </p>

          <span className="inline-block font-display text-xs tracking-[0.3em] text-subtle border border-border/60 rounded-full px-4 py-1.5 mb-10 backdrop-blur-sm">
            FREE TO PLAY
          </span>

          {/* Auth Buttons */}
          <div className="w-full max-w-sm flex flex-col gap-3">
            <GoogleButton onClick={onGoogle} loading={googleLoading} />
            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
              <span className="font-body text-xs text-[#444]">or</span>
              <div className="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent" />
            </div>
            <Btn onClick={() => onGo("signup")} disabled={googleLoading}>
              Get Started with Email
            </Btn>
            <Btn onClick={() => onGo("signin")} variant="ghost" disabled={googleLoading}>
              I Have an Account
            </Btn>
          </div>
        </div>
      </section>

      {/* ─── Demo Video ──────────────────────────────────── */}
      <section className="max-w-3xl mx-auto px-6 py-12 md:py-16">
        <div className="relative rounded-3xl overflow-hidden glass-card shadow-glow-lg group">
          <video
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            className="w-full aspect-video object-cover bg-surface transition-transform duration-700 group-hover:scale-[1.02]"
            aria-label="SkateHubba gameplay demo"
          >
            <source src="/SHvideoedit.mp4" type="video/mp4" />
          </video>
          {/* Vignette + gradient overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              boxShadow: "inset 0 0 80px rgba(0,0,0,0.5)",
              background: "linear-gradient(to top, rgba(10,10,10,0.4) 0%, transparent 30%)",
            }}
          />
        </div>
        <p className="font-body text-xs text-faint text-center mt-4 tracking-wide">
          See a real game in action — no edits, one take only.
        </p>
      </section>

      {/* ─── Divider ────────────────────────────────────── */}
      <div className="w-full h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* ─── How It Works ───────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20 md:py-28" aria-label="How it works">
        <h2 className="font-display text-fluid-3xl text-white text-center tracking-wider mb-3">HOW IT WORKS</h2>
        <p className="font-body text-fluid-sm text-faint text-center mb-14 max-w-sm mx-auto">
          Three steps to prove you&apos;re the best on the board.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 stagger-children">
          {HOW_IT_WORKS.map((item) => (
            <div
              key={item.step}
              className="group relative rounded-2xl glass-card p-6 hover:border-[rgba(255,107,0,0.2)] hover:-translate-y-1 transition-all duration-500 ease-smooth"
            >
              {/* Step number */}
              <span className="font-display text-5xl leading-none" style={{ color: item.color, opacity: 0.12 }}>
                {item.step}
              </span>
              <h3 className="font-display text-xl text-white tracking-wide mt-3 mb-2">{item.label}</h3>
              <p className="font-body text-sm text-faint leading-relaxed">{item.desc}</p>
              {/* Bottom accent line with glow */}
              <div
                className="absolute bottom-0 left-6 right-6 h-[2px] rounded-full opacity-0 group-hover:opacity-100 transition-all duration-500"
                style={{
                  background: `linear-gradient(90deg, ${item.color}, transparent)`,
                  boxShadow: `0 0 12px ${item.color}40`,
                }}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ─── Divider ────────────────────────────────────── */}
      <div className="w-full h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* ─── Game Preview / Phone Mockup ────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20 md:py-28">
        <div className="flex flex-col md:flex-row items-center gap-12 md:gap-16">
          {/* Phone mockup */}
          <div className="relative flex-shrink-0 animate-float">
            <div className="w-[240px] h-[420px] md:w-[280px] md:h-[500px] rounded-[2.5rem] border border-white/[0.08] bg-surface/80 backdrop-blur-xl overflow-hidden relative shadow-glass">
              {/* Phone notch — Dynamic Island style */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-20 h-5 bg-[#0A0A0A] rounded-full z-10" />
              {/* Screen content mockup */}
              <div className="absolute inset-3 top-8 rounded-2xl bg-[#111]/90 flex flex-col items-center justify-center gap-4 p-4">
                <span className="font-display text-sm tracking-[0.2em] text-brand-orange">GAME ON</span>
                <div className="flex gap-2">
                  {["S", "K", "A", "T", "E"].map((l, i) => (
                    <span
                      key={l}
                      className="font-display text-2xl transition-colors duration-300"
                      style={{
                        color: i < 2 ? "#FF3D00" : "#2A2A2A",
                        textShadow: i < 2 ? "0 0 12px rgba(255,61,0,0.5)" : "none",
                      }}
                    >
                      {l}
                    </span>
                  ))}
                </div>
                <div className="w-full h-24 rounded-xl bg-[#1A1A1A]/80 border border-white/[0.04] flex items-center justify-center">
                  <span className="font-body text-xs text-[#444]">trick video</span>
                </div>
                <div className="flex gap-2 w-full">
                  <div className="flex-1 h-9 rounded-lg bg-gradient-to-r from-brand-orange to-[#FF8533] flex items-center justify-center shadow-glow-sm">
                    <span className="font-display text-xs text-white tracking-wider">LANDED</span>
                  </div>
                  <div className="flex-1 h-9 rounded-lg bg-[#1A1A1A]/80 border border-white/[0.06] flex items-center justify-center">
                    <span className="font-display text-xs text-faint tracking-wider">MISSED</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Multi-layer glow behind phone */}
            <div className="absolute -inset-8 rounded-full bg-brand-orange/[0.07] blur-3xl -z-10" />
            <div className="absolute -inset-16 rounded-full bg-brand-orange/[0.03] blur-[80px] -z-20" />
          </div>

          {/* Text content */}
          <div className="flex-1 text-center md:text-left">
            <span className="font-display text-xs tracking-[0.3em] text-brand-orange mb-3 block">THE GAME</span>
            <h2 className="font-display text-fluid-3xl text-white tracking-wider mb-4">
              REAL TRICKS.
              <br />
              REAL PROOF.
            </h2>
            <p className="font-body text-muted leading-relaxed mb-6 max-w-md">
              Every trick is filmed in a single uncut take. No edits, no faking it. Your opponent watches your clip and
              has to match it — or take a letter. Five letters and you&apos;re out.
            </p>
            <ul className="space-y-3 text-left stagger-children">
              {[
                "One continuous video per trick",
                "24-hour window to respond",
                "S-K-A-T-E elimination format",
                "Play from anywhere, anytime",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3 group">
                  <span className="w-6 h-6 rounded-full bg-brand-orange/10 border border-brand-orange/20 flex items-center justify-center flex-shrink-0 group-hover:bg-brand-orange/20 group-hover:border-brand-orange/30 transition-all duration-300">
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#FF6B00"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <span className="font-body text-sm text-dim group-hover:text-white transition-colors duration-300">
                    {item}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── Divider ────────────────────────────────────── */}
      <div className="w-full h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* ─── Features Grid ──────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20 md:py-28" aria-label="Features">
        <h2 className="font-display text-fluid-3xl text-white text-center tracking-wider mb-3">BUILT FOR SKATERS</h2>
        <p className="font-body text-fluid-sm text-faint text-center mb-14 max-w-sm mx-auto">
          Every feature designed to keep it raw, fair, and competitive.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 stagger-children">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl glass-card p-6 hover:border-[rgba(255,107,0,0.15)] hover:-translate-y-1 transition-all duration-500 ease-smooth"
            >
              <div className="w-12 h-12 rounded-xl bg-brand-orange/[0.06] border border-brand-orange/10 flex items-center justify-center mb-4 group-hover:bg-brand-orange/[0.12] group-hover:shadow-glow-sm transition-all duration-500">
                {f.icon}
              </div>
              <h3 className="font-display text-lg text-white tracking-wide mb-2">{f.title}</h3>
              <p className="font-body text-sm text-faint leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Divider ────────────────────────────────────── */}
      <div className="w-full h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* ─── CTA / Bottom Section ───────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none animate-gradient"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 100%, rgba(255,107,0,0.08) 0%, transparent 60%), radial-gradient(ellipse 40% 30% at 30% 80%, rgba(255,61,0,0.04) 0%, transparent 50%)",
            backgroundSize: "200% 200%",
          }}
        />
        <div className="relative max-w-5xl mx-auto px-6 py-20 md:py-28 flex flex-col items-center text-center">
          <h2 className="font-display text-fluid-4xl text-white tracking-wider mb-4">READY TO PLAY?</h2>
          <p className="font-body text-muted mb-10 max-w-sm leading-relaxed">
            Grab your board, open the app, and prove you&apos;ve got what it takes.
          </p>

          <div className="w-full max-w-sm flex flex-col gap-3">
            <div className="animate-glow-pulse rounded-xl">
              <Btn onClick={() => onGo("signup")} disabled={googleLoading}>
                Start Playing — It&apos;s Free
              </Btn>
            </div>
            <Btn onClick={() => onGo("signin")} variant="ghost" disabled={googleLoading}>
              I Already Have an Account
            </Btn>
          </div>

          <InviteButton className="w-full max-w-sm mt-5" />
        </div>
      </section>

      {/* ─── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-white/[0.04] glass">
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col items-center md:items-start gap-1">
            <span className="font-display text-base tracking-[0.25em] text-brand-orange">
              SKATEHUBBA<span className="text-subtle">™</span>
            </span>
            <span className="font-body text-xs text-[#444]">The first async S.K.A.T.E. trick battle game.</span>
          </div>

          {/* Social Links */}
          <div className="flex gap-5 items-center justify-center mb-4" aria-label="Social media">
            <a
              href="https://x.com/skatehubba_"
              target="_blank"
              rel="noopener noreferrer"
              className="text-subtle hover:text-white transition-colors"
              aria-label="Follow on X"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://www.instagram.com/skatehubba_app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-subtle hover:text-white transition-colors"
              aria-label="Follow on Instagram"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
              </svg>
            </a>
            <a
              href="https://www.facebook.com/profile.php?id=61578731058004"
              target="_blank"
              rel="noopener noreferrer"
              className="text-subtle hover:text-white transition-colors"
              aria-label="Follow on Facebook"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </a>
          </div>

          <nav className="flex gap-6 flex-wrap justify-center" aria-label="Legal">
            <button
              type="button"
              onClick={() => onNav("privacy")}
              className="font-body text-xs text-subtle hover:text-muted transition-colors"
            >
              Privacy Policy
            </button>
            <button
              type="button"
              onClick={() => onNav("terms")}
              className="font-body text-xs text-subtle hover:text-muted transition-colors"
            >
              Terms of Service
            </button>
            <button
              type="button"
              onClick={() => onNav("datadeletion")}
              className="font-body text-xs text-subtle hover:text-muted transition-colors"
            >
              Data Deletion
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
