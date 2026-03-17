import { useState, useEffect } from "react";
import { BG } from "../utils/helpers";
import { Btn } from "../components/ui/Btn";
import { GoogleButton } from "../components/GoogleButton";
import { InviteButton } from "../components/InviteButton";

/* ── Inline SVG icons ────────────────────────────────────── */

function SkateboardHero({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="120"
      height="120"
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {/* Deck with kicktail */}
      <path d="M15 52 C10 52 8 48 12 44 L18 44 L102 44 L108 44 C112 48 110 52 105 52 Z" fill="#FF6B00" />
      {/* Grip tape */}
      <rect x="20" y="45" width="80" height="5" rx="2.5" fill="#CC5500" opacity="0.4" />
      {/* Left truck */}
      <rect x="26" y="53" width="14" height="4" rx="2" fill="#666" />
      {/* Right truck */}
      <rect x="80" y="53" width="14" height="4" rx="2" fill="#666" />
      {/* Left wheels */}
      <circle cx="29" cy="63" r="6" fill="#333" />
      <circle cx="29" cy="63" r="3.5" fill="#555" />
      <circle cx="29" cy="63" r="1.5" fill="#777" />
      <circle cx="37" cy="63" r="6" fill="#333" />
      <circle cx="37" cy="63" r="3.5" fill="#555" />
      <circle cx="37" cy="63" r="1.5" fill="#777" />
      {/* Right wheels */}
      <circle cx="83" cy="63" r="6" fill="#333" />
      <circle cx="83" cy="63" r="3.5" fill="#555" />
      <circle cx="83" cy="63" r="1.5" fill="#777" />
      <circle cx="91" cy="63" r="6" fill="#333" />
      <circle cx="91" cy="63" r="3.5" fill="#555" />
      <circle cx="91" cy="63" r="1.5" fill="#777" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF6B00"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="23 7 16 12 23 17 23 7" />
      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF6B00"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function FlameIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF6B00"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF6B00"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function TrophyIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF6B00"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#FF6B00"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

/* ── Data ────────────────────────────────────────────────── */

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
    icon: <VideoIcon />,
    title: "One-Take Video",
    desc: "No editing. No second chances. Film your trick in one continuous take to keep it real.",
  },
  {
    icon: <ClockIcon />,
    title: "24hr Async Turns",
    desc: "Play on your schedule. Each player gets a full day to film and submit their trick.",
  },
  {
    icon: <FlameIcon />,
    title: "No Trick Farming",
    desc: "Every trick counts. No spamming easy tricks — the game rewards creativity and skill.",
  },
  {
    icon: <ShieldIcon />,
    title: "Fair Play",
    desc: "One take only means what you see is what you get. No room for faking it.",
  },
  {
    icon: <TrophyIcon />,
    title: "Competitive Rankings",
    desc: "Build your reputation. Win games, climb the leaderboard, become the GOAT.",
  },
  {
    icon: <UsersIcon />,
    title: "Challenge Anyone",
    desc: "Invite your crew or battle strangers. All you need is a board and a phone.",
  },
] as const;

const SKATE_LETTERS = ["S", "K", "A", "T", "E"];

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
  onNav: (screen: "privacy" | "terms") => void;
}) {
  const [visibleLetters, setVisibleLetters] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setVisibleLetters((prev) => {
        if (prev >= SKATE_LETTERS.length) {
          clearInterval(id);
          return prev;
        }
        return prev + 1;
      });
    }, 120);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-dvh" style={{ background: BG }}>
      {/* ─── Sticky Nav Bar ─────────────────────────────── */}
      <nav className="sticky top-0 z-50 backdrop-blur-md bg-[#0A0A0A]/80 border-b border-border">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <span className="font-display text-lg tracking-[0.25em] text-brand-orange">
            SKATEHUBBA<span className="text-[#555]">™</span>
          </span>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onGo("signin")}
              className="font-display text-sm tracking-wider text-[#888] hover:text-white transition-colors"
            >
              LOG IN
            </button>
            <button
              type="button"
              onClick={() => onGo("signup")}
              className="font-display text-sm tracking-wider bg-brand-orange text-white px-5 py-2 rounded-lg hover:bg-[#E65F00] transition-colors active:scale-[0.97]"
            >
              SIGN UP
            </button>
          </div>
        </div>
      </nav>

      {/* ─── Hero Section ───────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Background glow */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 80% 50% at 50% 0%, rgba(255,107,0,0.08) 0%, transparent 70%)",
          }}
        />
        {/* Subtle grid pattern */}
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.03]"
          style={{
            backgroundImage:
              "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)",
            backgroundSize: "60px 60px",
          }}
        />

        <div className="relative max-w-5xl mx-auto px-6 pt-16 pb-20 md:pt-24 md:pb-28 flex flex-col items-center text-center">
          <SkateboardHero className="animate-board-roll mb-6 drop-shadow-[0_0_30px_rgba(255,107,0,0.2)]" />

          {/* Animated SKATE letters */}
          <h1 className="sr-only">S.K.A.T.E.</h1>
          <div className="flex gap-3 md:gap-5 mb-6" aria-hidden="true">
            {SKATE_LETTERS.map((letter, i) => (
              <span
                key={letter}
                className="font-display text-[clamp(60px,14vw,110px)] leading-none transition-all duration-300"
                style={{
                  color: i < visibleLetters ? "#FF6B00" : "#1A1A1A",
                  textShadow: i < visibleLetters ? "0 0 40px rgba(255,107,0,0.3)" : "none",
                  transform: i < visibleLetters ? "translateY(0) scale(1)" : "translateY(12px) scale(0.9)",
                  opacity: i < visibleLetters ? 1 : 0.2,
                }}
              >
                {letter}
              </span>
            ))}
          </div>

          <p className="font-body text-lg md:text-xl text-[#888] max-w-md leading-relaxed mb-4">
            The first async trick battle game.
            <br />
            <span className="text-white font-medium">Set tricks. Match tricks. One take only.</span>
          </p>

          <span className="inline-block font-display text-xs tracking-[0.3em] text-[#555] border border-border rounded-full px-4 py-1.5 mb-10">
            FREE TO PLAY
          </span>

          {/* Auth Buttons */}
          <div className="w-full max-w-sm flex flex-col gap-3">
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
          </div>
        </div>
      </section>

      {/* ─── Divider ────────────────────────────────────── */}
      <div className="w-full h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* ─── How It Works ───────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-20 md:py-28" aria-label="How it works">
        <h2 className="font-display text-3xl md:text-4xl text-white text-center tracking-wider mb-3">HOW IT WORKS</h2>
        <p className="font-body text-sm text-[#666] text-center mb-14 max-w-sm mx-auto">
          Three steps to prove you&apos;re the best on the board.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {HOW_IT_WORKS.map((item) => (
            <div
              key={item.step}
              className="group relative rounded-2xl bg-surface border border-border p-6 hover:border-[rgba(255,107,0,0.3)] transition-all duration-300"
            >
              {/* Step number */}
              <span className="font-display text-5xl leading-none" style={{ color: item.color, opacity: 0.15 }}>
                {item.step}
              </span>
              <h3 className="font-display text-xl text-white tracking-wide mt-3 mb-2">{item.label}</h3>
              <p className="font-body text-sm text-[#666] leading-relaxed">{item.desc}</p>
              {/* Bottom accent line */}
              <div
                className="absolute bottom-0 left-6 right-6 h-[2px] rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                style={{ background: `linear-gradient(90deg, ${item.color}, transparent)` }}
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
          <div className="relative flex-shrink-0">
            <div className="w-[240px] h-[420px] md:w-[280px] md:h-[500px] rounded-[2.5rem] border-2 border-[#2A2A2A] bg-surface overflow-hidden relative shadow-[0_0_60px_rgba(255,107,0,0.06)]">
              {/* Phone notch */}
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-[#0A0A0A] rounded-b-2xl z-10" />
              {/* Screen content mockup */}
              <div className="absolute inset-3 top-8 rounded-2xl bg-[#111] flex flex-col items-center justify-center gap-4 p-4">
                <span className="font-display text-sm tracking-[0.2em] text-brand-orange">GAME ON</span>
                <div className="flex gap-2">
                  {SKATE_LETTERS.map((l, i) => (
                    <span key={l} className="font-display text-2xl" style={{ color: i < 2 ? "#FF3D00" : "#2A2A2A" }}>
                      {l}
                    </span>
                  ))}
                </div>
                <div className="w-full h-24 rounded-xl bg-[#1A1A1A] border border-border flex items-center justify-center">
                  <span className="font-body text-xs text-[#444]">trick video</span>
                </div>
                <div className="flex gap-2 w-full">
                  <div className="flex-1 h-9 rounded-lg bg-brand-orange flex items-center justify-center">
                    <span className="font-display text-xs text-white tracking-wider">LANDED</span>
                  </div>
                  <div className="flex-1 h-9 rounded-lg bg-[#1A1A1A] border border-border flex items-center justify-center">
                    <span className="font-display text-xs text-[#666] tracking-wider">MISSED</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Glow behind phone */}
            <div className="absolute -inset-8 rounded-full bg-brand-orange/5 blur-3xl -z-10" />
          </div>

          {/* Text content */}
          <div className="flex-1 text-center md:text-left">
            <span className="font-display text-xs tracking-[0.3em] text-brand-orange mb-3 block">THE GAME</span>
            <h2 className="font-display text-3xl md:text-4xl text-white tracking-wider mb-4">
              REAL TRICKS.
              <br />
              REAL PROOF.
            </h2>
            <p className="font-body text-[#888] leading-relaxed mb-6 max-w-md">
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
                  <span className="w-5 h-5 rounded-full bg-[rgba(255,107,0,0.1)] flex items-center justify-center flex-shrink-0">
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
                  <span className="font-body text-sm text-[#999]">{item}</span>
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
        <h2 className="font-display text-3xl md:text-4xl text-white text-center tracking-wider mb-3">
          BUILT FOR SKATERS
        </h2>
        <p className="font-body text-sm text-[#666] text-center mb-14 max-w-sm mx-auto">
          Every feature designed to keep it raw, fair, and competitive.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl bg-surface border border-border p-6 hover:border-[rgba(255,107,0,0.2)] transition-all duration-300"
            >
              <div className="w-12 h-12 rounded-xl bg-[rgba(255,107,0,0.06)] border border-[rgba(255,107,0,0.1)] flex items-center justify-center mb-4 group-hover:bg-[rgba(255,107,0,0.1)] transition-colors duration-300">
                {f.icon}
              </div>
              <h3 className="font-display text-lg text-white tracking-wide mb-2">{f.title}</h3>
              <p className="font-body text-sm text-[#666] leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ─── Divider ────────────────────────────────────── */}
      <div className="w-full h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      {/* ─── CTA / Bottom Section ───────────────────────── */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "radial-gradient(ellipse 60% 50% at 50% 100%, rgba(255,107,0,0.06) 0%, transparent 70%)",
          }}
        />
        <div className="relative max-w-5xl mx-auto px-6 py-20 md:py-28 flex flex-col items-center text-center">
          <h2 className="font-display text-4xl md:text-5xl text-white tracking-wider mb-4">READY TO PLAY?</h2>
          <p className="font-body text-[#888] mb-10 max-w-sm leading-relaxed">
            Grab your board, open the app, and prove you&apos;ve got what it takes.
          </p>

          <div className="w-full max-w-sm flex flex-col gap-3">
            <Btn onClick={() => onGo("signup")} disabled={googleLoading}>
              Start Playing — It&apos;s Free
            </Btn>
            <Btn onClick={() => onGo("signin")} variant="ghost" disabled={googleLoading}>
              I Already Have an Account
            </Btn>
          </div>

          <InviteButton className="w-full max-w-sm mt-5" />
        </div>
      </section>

      {/* ─── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="max-w-5xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex flex-col items-center md:items-start gap-1">
            <span className="font-display text-base tracking-[0.25em] text-brand-orange">
              SKATEHUBBA<span className="text-[#555]">™</span>
            </span>
            <span className="font-body text-xs text-[#444]">The first async S.K.A.T.E. trick battle game.</span>
          </div>

          <nav className="flex gap-6 flex-wrap justify-center" aria-label="Legal">
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
        </div>
      </footer>
    </div>
  );
}
