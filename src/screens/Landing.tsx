import { GoogleButton } from "../components/GoogleButton";
import { InviteButton } from "../components/InviteButton";
import { SkateButton } from "../components/SkateButton";
import { playOlliePop } from "../utils/ollieSound";
import { VideoIcon, ClockIcon, FlameIcon, ShieldIcon, TrophyIcon, UsersIcon } from "../components/icons";

/* ── Data ────────────────────────────────────────────────── */

const BRAND_ICON_CLASS = "text-brand-orange";

const HOW_IT_WORKS = [
  {
    step: "01",
    label: "Film It",
    desc: "One take. One chance. Land your trick on camera or don't bother.",
    color: "#FF6B00",
  },
  {
    step: "02",
    label: "Send the Challenge",
    desc: "Call out your opponent. They got 24 hours to match it or eat a letter.",
    color: "#FF8533",
  },
  {
    step: "03",
    label: "Spell It Out",
    desc: "Miss the trick, take the letter. S-K-A-T-E and you're done.",
    color: "#FFA366",
  },
] as const;

const FEATURES = [
  {
    icon: <VideoIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "One Take",
    desc: "No editing. No do-overs. You film it, it counts. Period.",
  },
  {
    icon: <ClockIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "24hr Turns",
    desc: "Play when you want. You got a full day to get out there and film.",
  },
  {
    icon: <FlameIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "No Trick Farming",
    desc: "Can't spam kickflips all day. Step it up or get spelled out.",
  },
  {
    icon: <ShieldIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "No Faking",
    desc: "One continuous take. What you see is what happened. That's it.",
  },
  {
    icon: <TrophyIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "Rankings",
    desc: "Win games, stack stats, climb the board. Talk is cheap.",
  },
  {
    icon: <UsersIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "Run It With Anyone",
    desc: "Your crew, randoms, whoever. All you need is a board and a phone.",
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
      <nav className="fixed top-0 left-0 right-0 z-50 glass border-b border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <img src="/logonew.webp" alt="SkateHubba" draggable={false} className="h-9 md:h-11 w-auto select-none" />
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => {
                playOlliePop();
                onGo("signin");
              }}
              className="font-body text-sm text-dim hover:text-white transition-colors duration-200"
            >
              Log in
            </button>
            <button
              type="button"
              onClick={() => {
                playOlliePop();
                onGo("signup");
              }}
              className="font-body text-sm font-medium bg-white text-[#0A0A0A] px-5 py-2 rounded-lg hover:bg-white/90 transition-all duration-200 active:scale-[0.97]"
            >
              Sign up
            </button>
          </div>
        </div>
      </nav>

      {/* ─── Hero Section (full viewport) ───────────────── */}
      <section className="relative min-h-dvh flex flex-col items-center justify-center overflow-hidden">
        {/* Layered ambient glow */}
        <div className="absolute inset-0 pointer-events-none bg-hero-glow" />

        <div className="relative max-w-6xl mx-auto px-6 flex flex-col items-center text-center hero-stagger">
          {/* Badge */}
          <span className="inline-flex items-center gap-2 font-body text-xs tracking-wide text-brand-orange/80 border border-brand-orange/15 rounded-full px-4 py-1.5 mb-8 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-rec-pulse" />
            Free to play
          </span>

          {/* Main headline */}
          <h1 className="font-display tracking-wide text-white mb-5 leading-[0.9] text-[clamp(3rem,2.2rem_+_4.5vw,6.5rem)]">
            <span className="block">SET IT. MATCH IT.</span>
            <span className="block text-brand-orange [text-shadow:0_0_60px_rgba(255,107,0,0.35),0_0_120px_rgba(255,107,0,0.15)]">
              ONE TAKE.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="font-body text-fluid-lg text-dim max-w-md leading-relaxed mb-10">
            Async S.K.A.T.E. No edits. No excuses. Film your trick and put up or shut up.
          </p>

          {/* Auth Buttons */}
          <div className="w-full max-w-sm flex flex-col gap-3">
            <GoogleButton
              onClick={() => {
                playOlliePop();
                onGoogle();
              }}
              loading={googleLoading}
            />
            <div className="flex items-center gap-3 my-0.5">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="font-body text-xs text-[#555]">or</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>
            <SkateButton onClick={() => onGo("signup")} disabled={googleLoading}>
              Sign In / Sign Up
            </SkateButton>
          </div>
        </div>

        {/* Scroll indicator */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-scroll-hint">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-white/30"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </div>
      </section>

      {/* ─── Demo Video ──────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-16 md:py-24">
        <div className="video-showcase">
          <div className="relative rounded-2xl overflow-hidden border border-white/[0.08] shadow-[0_0_80px_rgba(255,107,0,0.06),0_20px_60px_rgba(0,0,0,0.4)]">
            <video
              autoPlay
              loop
              muted
              playsInline
              preload="metadata"
              className="w-full aspect-video object-cover bg-surface"
              aria-label="SkateHubba gameplay demo"
            >
              <source src="/SHvideoedit.mp4" type="video/mp4" />
            </video>
            {/* Bottom fade */}
            <div className="absolute inset-0 pointer-events-none bg-video-overlay" />
            {/* Caption overlay */}
            <div className="absolute bottom-4 left-5 right-5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-brand-red animate-rec-pulse" />
                <span className="font-body text-xs text-white/70">Real game. No edits. No cap.</span>
              </div>
              <span className="font-display text-xs tracking-widest text-white/30">SKATEHUBBA</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── How It Works ───────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-28" aria-label="How it works">
        <div className="text-center mb-14 md:mb-20">
          <span className="font-display text-xs tracking-[0.3em] text-brand-orange/60 mb-3 block">THE DEAL</span>
          <h2 className="font-display text-fluid-3xl text-white tracking-wider">HOW IT WORKS</h2>
        </div>

        {/* Steps with connecting line on desktop */}
        <div className="relative">
          {/* Connecting line (desktop only) */}
          <div className="hidden md:block absolute top-8 left-[16.67%] right-[16.67%] h-px bg-gradient-to-r from-[#FF6B00]/20 via-[#FF8533]/20 to-[#FFA366]/20" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-6">
            {HOW_IT_WORKS.map((item) => (
              <div key={item.step} className="relative flex flex-col items-center text-center">
                {/* Step circle */}
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center mb-5 relative z-10"
                  style={{
                    background: `radial-gradient(circle, ${item.color}18, ${item.color}08)`,
                    border: `1px solid ${item.color}25`,
                    boxShadow: `0 0 30px ${item.color}10`,
                  }}
                >
                  <span className="font-display text-xl" style={{ color: item.color }}>
                    {item.step}
                  </span>
                </div>
                <h3 className="font-display text-xl text-white tracking-wide mb-2">{item.label}</h3>
                <p className="font-body text-sm text-faint leading-relaxed max-w-[260px]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Game Preview / Phone Mockup ────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-28">
        <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
          {/* Phone mockup */}
          <div className="relative flex-shrink-0 animate-float">
            <div className="w-[220px] h-[400px] md:w-[260px] md:h-[480px] rounded-[2.5rem] border border-white/[0.08] bg-[#111] overflow-hidden relative shadow-glass">
              {/* Dynamic Island */}
              <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-16 h-4 bg-[#0A0A0A] rounded-full z-10" />
              {/* Screen content */}
              <div className="absolute inset-3 top-8 rounded-2xl bg-[#0D0D0D] flex flex-col items-center justify-center gap-3 p-4">
                <span className="font-display text-xs tracking-[0.25em] text-brand-orange/80">GAME ON</span>
                <div className="flex gap-1.5">
                  {["S", "K", "A", "T", "E"].map((l, i) => (
                    <span
                      key={l}
                      className="font-display text-xl"
                      style={{
                        color: i < 2 ? "#FF3D00" : "#222",
                        textShadow: i < 2 ? "0 0 8px rgba(255,61,0,0.4)" : "none",
                      }}
                    >
                      {l}
                    </span>
                  ))}
                </div>
                <div className="w-full h-20 rounded-lg bg-[#161616] border border-white/[0.04] flex items-center justify-center">
                  <span className="font-body text-[10px] text-[#333]">trick video</span>
                </div>
                <div className="flex gap-2 w-full">
                  <div className="flex-1 h-8 rounded-lg bg-gradient-to-r from-brand-orange to-[#FF8533] flex items-center justify-center">
                    <span className="font-display text-[10px] text-white tracking-wider">LANDED</span>
                  </div>
                  <div className="flex-1 h-8 rounded-lg bg-[#161616] border border-white/[0.06] flex items-center justify-center">
                    <span className="font-display text-[10px] text-faint tracking-wider">MISSED</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Glow */}
            <div className="absolute -inset-12 rounded-full bg-brand-orange/[0.06] blur-3xl -z-10" />
            <div className="absolute -inset-20 rounded-full bg-brand-orange/[0.03] blur-[80px] -z-20" />
          </div>

          {/* Text content */}
          <div className="flex-1 text-center md:text-left">
            <span className="font-display text-xs tracking-[0.3em] text-brand-orange/60 mb-4 block">THE GAME</span>
            <h2 className="font-display text-fluid-3xl text-white tracking-wider mb-4 leading-[1.1]">
              NO EDITS.
              <br />
              NO EXCUSES.
            </h2>
            <p className="font-body text-sm text-dim leading-relaxed mb-8 max-w-md">
              Every trick is one uncut take. Your opponent watches your clip and either matches it or takes a letter.
              Five letters and you&apos;re out. Simple as that.
            </p>
            <ul className="space-y-3 text-left">
              {[
                "One continuous take per trick",
                "24 hours to respond",
                "S-K-A-T-E elimination",
                "Play from anywhere",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-orange flex-shrink-0" />
                  <span className="font-body text-sm text-dim">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── Features Grid ──────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-28" aria-label="Features">
        <div className="text-center mb-14 md:mb-20">
          <span className="font-display text-xs tracking-[0.3em] text-brand-orange/60 mb-3 block">WHAT YOU GET</span>
          <h2 className="font-display text-fluid-3xl text-white tracking-wider">BUILT DIFFERENT</h2>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:border-brand-orange/15 hover:bg-white/[0.04] transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-brand-orange/[0.08] flex items-center justify-center mb-3 group-hover:bg-brand-orange/[0.14] group-hover:shadow-[0_0_20px_rgba(255,107,0,0.08)] transition-all duration-300">
                {f.icon}
              </div>
              <h3 className="font-display text-base text-white tracking-wide mb-1.5">{f.title}</h3>
              <p className="font-body text-sm text-faint leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── CTA / Bottom Section ───────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Strong ambient glow */}
        <div className="absolute inset-0 pointer-events-none bg-cta-glow" />
        <div className="relative max-w-6xl mx-auto px-6 py-24 md:py-32 flex flex-col items-center text-center">
          <h2 className="font-display text-white tracking-wider mb-4 leading-[0.95] text-[clamp(2rem,1.5rem_+_3vw,4.5rem)]">
            QUIT SCROLLING.
          </h2>
          <p className="font-body text-dim mb-10 max-w-xs leading-relaxed">
            Board. Phone. That&apos;s all you need. Get in.
          </p>

          <div className="w-full max-w-sm flex flex-col gap-4">
            <div className="animate-glow-pulse rounded-xl">
              <SkateButton onClick={() => onGo("signup")} disabled={googleLoading}>
                Start Playing
              </SkateButton>
            </div>
          </div>

          <InviteButton className="w-full max-w-sm mt-6" />
        </div>
      </section>

      {/* ─── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-white/[0.05]">
        <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col items-center md:items-start gap-1">
            <span className="font-display text-sm tracking-[0.2em] text-white/40">
              SKATEHUBBA<span className="text-white/20">™</span>
            </span>
            <span className="font-body text-xs text-[#333]">Async S.K.A.T.E. One take only.</span>
          </div>

          {/* Social Links */}
          <div className="flex gap-4 items-center" aria-label="Social media">
            <a
              href="https://x.com/skatehubba_"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#444] hover:text-white/60 transition-colors duration-200"
              aria-label="Follow on X"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
            <a
              href="https://www.instagram.com/skatehubba_app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#444] hover:text-white/60 transition-colors duration-200"
              aria-label="Follow on Instagram"
            >
              <svg
                width="16"
                height="16"
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
              className="text-[#444] hover:text-white/60 transition-colors duration-200"
              aria-label="Follow on Facebook"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
              </svg>
            </a>
          </div>

          <nav className="flex gap-5 flex-wrap justify-center" aria-label="Legal">
            <button
              type="button"
              onClick={() => onNav("privacy")}
              className="font-body text-xs text-[#444] hover:text-dim transition-colors duration-200"
            >
              Privacy
            </button>
            <button
              type="button"
              onClick={() => onNav("terms")}
              className="font-body text-xs text-[#444] hover:text-dim transition-colors duration-200"
            >
              Terms
            </button>
            <button
              type="button"
              onClick={() => onNav("datadeletion")}
              className="font-body text-xs text-[#444] hover:text-dim transition-colors duration-200"
            >
              Data Deletion
            </button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
