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
    label: "Set a Trick",
    desc: "Film yourself landing a trick in one continuous take. No edits, no retakes — raw skill only.",
    color: "#FF6B00",
  },
  {
    step: "02",
    label: "Send the Challenge",
    desc: "Your opponent has 24 hours to match your trick or set one back.",
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
    icon: <VideoIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "One-Take Video",
    desc: "No editing. No second chances. One continuous take keeps it real.",
  },
  {
    icon: <ClockIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "24hr Async Turns",
    desc: "Play on your schedule. A full day to film and submit your trick.",
  },
  {
    icon: <FlameIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "No Trick Farming",
    desc: "Every trick counts. The game rewards creativity and skill.",
  },
  {
    icon: <ShieldIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "Fair Play",
    desc: "What you see is what you get. No room for faking it.",
  },
  {
    icon: <TrophyIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "Competitive Rankings",
    desc: "Win games, climb the leaderboard, become the GOAT.",
  },
  {
    icon: <UsersIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "Challenge Anyone",
    desc: "Invite your crew or battle strangers. Board and phone is all you need.",
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
      <nav className="sticky top-0 z-50 glass border-b border-white/[0.05]">
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

      {/* ─── Hero Section ───────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Ambient glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 70% 50% at 50% -10%, rgba(255,107,0,0.12) 0%, transparent 70%)",
          }}
        />

        <div className="relative max-w-6xl mx-auto px-6 pt-20 pb-8 md:pt-32 md:pb-12 flex flex-col items-center text-center">
          {/* Badge */}
          <span className="inline-flex items-center gap-2 font-body text-xs tracking-wide text-brand-orange/80 border border-brand-orange/15 rounded-full px-4 py-1.5 mb-8 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-rec-pulse" />
            Free to play
          </span>

          {/* Main headline */}
          <h1 className="font-display text-fluid-hero tracking-wide text-white mb-4 leading-[0.95]">
            <span className="block">TRICK BATTLES.</span>
            <span className="block text-brand-orange" style={{ textShadow: "0 0 40px rgba(255,107,0,0.3)" }}>
              ONE TAKE ONLY.
            </span>
          </h1>

          <p className="font-body text-fluid-base text-dim max-w-lg leading-relaxed mb-10">
            The first async S.K.A.T.E. game. Film your trick, send the challenge, prove you&apos;re the best — no edits,
            no retakes.
          </p>

          {/* Auth Buttons */}
          <div className="w-full max-w-sm flex flex-col gap-3 mb-4">
            <GoogleButton
              onClick={() => {
                playOlliePop();
                onGoogle();
              }}
              loading={googleLoading}
            />
            <div className="flex items-center gap-3 my-1">
              <div className="flex-1 h-px bg-white/[0.06]" />
              <span className="font-body text-xs text-[#555]">or</span>
              <div className="flex-1 h-px bg-white/[0.06]" />
            </div>
            <SkateButton onClick={() => onGo("signup")} disabled={googleLoading}>
              Sign In / Sign Up
            </SkateButton>
          </div>
        </div>
      </section>

      {/* ─── Demo Video ──────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pt-8 pb-16 md:pt-12 md:pb-24">
        <div className="relative rounded-2xl overflow-hidden border border-white/[0.06] group">
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
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "linear-gradient(to top, rgba(10,10,10,0.5) 0%, transparent 25%)",
            }}
          />
          {/* Caption overlay */}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
            <span className="font-body text-xs text-white/60">Real game — no edits</span>
            <span className="font-display text-xs tracking-wider text-brand-orange/60">SKATEHUBBA</span>
          </div>
        </div>
      </section>

      {/* ─── How It Works ───────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-24" aria-label="How it works">
        <div className="text-center mb-12 md:mb-16">
          <h2 className="font-display text-fluid-3xl text-white tracking-wider mb-3">HOW IT WORKS</h2>
          <p className="font-body text-sm text-faint max-w-xs mx-auto">
            Three steps. One board. Prove you&apos;re the best.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
          {HOW_IT_WORKS.map((item) => (
            <div
              key={item.step}
              className="group relative rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 hover:border-white/[0.1] hover:bg-white/[0.04] transition-all duration-300"
            >
              <div className="flex items-baseline gap-3 mb-3">
                <span className="font-display text-3xl leading-none" style={{ color: item.color, opacity: 0.25 }}>
                  {item.step}
                </span>
                <h3 className="font-display text-lg text-white tracking-wide">{item.label}</h3>
              </div>
              <p className="font-body text-sm text-faint leading-relaxed">{item.desc}</p>
              {/* Bottom accent */}
              <div
                className="absolute bottom-0 left-6 right-6 h-px opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: `linear-gradient(90deg, ${item.color}60, transparent)` }}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ─── Game Preview / Phone Mockup ────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-24">
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
            <div className="absolute -inset-10 rounded-full bg-brand-orange/[0.05] blur-3xl -z-10" />
          </div>

          {/* Text content */}
          <div className="flex-1 text-center md:text-left">
            <span className="font-display text-xs tracking-[0.3em] text-brand-orange/70 mb-4 block">THE GAME</span>
            <h2 className="font-display text-fluid-3xl text-white tracking-wider mb-4 leading-[1.1]">
              REAL TRICKS.
              <br />
              REAL PROOF.
            </h2>
            <p className="font-body text-sm text-dim leading-relaxed mb-8 max-w-md">
              Every trick is filmed in a single uncut take. No edits, no faking it. Your opponent watches your clip and
              has to match it — or take a letter. Five letters and you&apos;re out.
            </p>
            <ul className="space-y-3 text-left">
              {[
                "One continuous video per trick",
                "24-hour window to respond",
                "S-K-A-T-E elimination format",
                "Play from anywhere, anytime",
              ].map((item) => (
                <li key={item} className="flex items-center gap-3">
                  <span className="w-5 h-5 rounded-full bg-brand-orange/10 flex items-center justify-center flex-shrink-0">
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
                  <span className="font-body text-sm text-dim">{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ─── Features Grid ──────────────────────────────── */}
      <section className="max-w-6xl mx-auto px-6 py-16 md:py-24" aria-label="Features">
        <div className="text-center mb-12 md:mb-16">
          <h2 className="font-display text-fluid-3xl text-white tracking-wider mb-3">BUILT FOR SKATERS</h2>
          <p className="font-body text-sm text-faint max-w-xs mx-auto">
            Every feature keeps it raw, fair, and competitive.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:border-white/[0.1] hover:bg-white/[0.04] transition-all duration-300"
            >
              <div className="w-10 h-10 rounded-lg bg-brand-orange/[0.08] flex items-center justify-center mb-3 group-hover:bg-brand-orange/[0.14] transition-colors duration-300">
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
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 60% 40% at 50% 100%, rgba(255,107,0,0.08) 0%, transparent 70%)",
          }}
        />
        <div className="relative max-w-6xl mx-auto px-6 py-20 md:py-28 flex flex-col items-center text-center">
          <h2 className="font-display text-fluid-4xl text-white tracking-wider mb-3">READY TO PLAY?</h2>
          <p className="font-body text-sm text-dim mb-8 max-w-sm leading-relaxed">
            Grab your board, open the app, and prove you&apos;ve got what it takes.
          </p>

          <div className="w-full max-w-sm flex flex-col gap-4">
            <div className="animate-glow-pulse rounded-xl">
              <SkateButton onClick={() => onGo("signup")} disabled={googleLoading}>
                Start Playing — It&apos;s Free
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
            <span className="font-body text-xs text-[#333]">The first async S.K.A.T.E. trick battle game.</span>
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
