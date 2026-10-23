import { useCallback, useEffect, useState } from "react";
import { AppleButton } from "../components/AppleButton";
import { GoogleButton } from "../components/GoogleButton";
import { InviteButton } from "../components/InviteButton";
import { LandingDemoVideo } from "../components/LandingDemoVideo";
import { TermsAgreementNotice } from "../components/legal/TermsAgreementNotice";
import { SkateButton } from "../components/SkateButton";
import { isAppleSignInEnabled } from "../lib/featureFlags";
import { FEATURES, HOW_IT_WORKS } from "./landingContent";
import { LandingFooter } from "./LandingFooter";

// Feature freeze (2026-10): the spot-map teaser ("30+ spots, live in LA",
// locked pins, "Unlock the Map") was removed from the landing page so
// mapbox-gl and map tiles never load here. The page now sells only the core
// S.K.A.T.E. Challenge loop. The LandingMap component is kept (unused) under
// src/components/map/ in case the teaser returns with the Map feature — see
// src/lib/featureFlags.ts.

/* ── Types ───────────────────────────────────────────────── */

type AuthMode = "signup" | "signin";
export type LegalScreen = "privacy" | "terms" | "datadeletion";

export type LandingProps = {
  onGo: (mode: AuthMode) => void;
  onGoogle: () => void;
  googleLoading: boolean;
  onApple: () => void;
  appleLoading: boolean;
  onNav: (screen: LegalScreen) => void;
};

/* ── Data ────────────────────────────────────────────────── */

/* ── Component ───────────────────────────────────────────── */

// The hero entrance animation plays once per page load. The landing can be
// mounted twice in quick succession (the boot landing painted before the full
// app loads, then App's own landing route — see src/boot/landingBoot.ts), and
// replaying the entrance on that swap would look like a glitch.
let heroEntrancePlayed = false;

/** @internal test-only reset */
export function __resetHeroEntranceForTest(): void {
  heroEntrancePlayed = false;
}

export function Landing({ onGo, onGoogle, googleLoading, onApple, appleLoading, onNav }: LandingProps) {
  const handleAuth = useCallback(
    (mode: AuthMode) => () => {
      onGo(mode);
    },
    [onGo],
  );

  const handleGoogle = useCallback(() => {
    onGoogle();
  }, [onGoogle]);

  const handleApple = useCallback(() => {
    onApple();
  }, [onApple]);

  const appleOn = isAppleSignInEnabled();
  const socialLoading = googleLoading || (appleOn && appleLoading);

  const [animateHero] = useState(() => !heroEntrancePlayed);
  useEffect(() => {
    heroEntrancePlayed = true;
  }, []);

  return (
    <div className="min-h-dvh pb-28 md:pb-0">
      {/* ─── Sticky Nav Bar ─────────────────────────────── */}
      <nav
        aria-label="Primary"
        className="fixed top-below-overlay left-0 right-0 z-50 glass border-b border-white/[0.05] pt-safe-inset"
      >
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <a
            href="#hero"
            aria-label="SkateHubba home"
            className="inline-flex min-h-11 items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            <img
              src="/logonew.webp"
              alt="SkateHubba"
              width={1536}
              height={1024}
              draggable={false}
              fetchPriority="high"
              decoding="async"
              className="h-9 md:h-11 w-auto select-none"
            />
          </a>
          <button
            type="button"
            onClick={handleAuth("signin")}
            className="inline-flex min-h-11 items-center font-body text-sm text-dim hover:text-white px-3 rounded-md transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            Account
          </button>
        </div>
      </nav>

      {/* ─── Hero Section (full viewport) ───────────────── */}
      <section
        id="hero"
        aria-labelledby="hero-heading"
        className="landing-hero relative min-h-dvh flex flex-col items-center justify-center overflow-x-hidden pt-[calc(env(safe-area-inset-top)+3.5rem)] pb-[var(--consent-banner-space,0px)] [@media(max-height:500px)]:justify-start [@media(max-height:500px)]:overflow-y-auto"
      >
        {/* Layered ambient glow */}
        <div className="absolute inset-0 pointer-events-none bg-hero-glow" />

        <div
          className={`relative max-w-6xl mx-auto px-6 flex flex-col items-center text-center${animateHero ? " hero-stagger" : ""}`}
        >
          {/* Badge */}
          <span className="landing-kicker inline-flex items-center gap-2 font-body text-xs tracking-wide text-brand-orange/80 border border-brand-orange/15 rounded-full px-4 py-1.5 mb-8 backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-orange animate-rec-pulse" />
            Free to play
          </span>

          {/* Main headline */}
          {/* hero-lcp: the heading is the page's LCP element, so it must be
              visible in the very first frame (see .hero-stagger in index.css). */}
          <h1
            id="hero-heading"
            className="hero-lcp font-display tracking-wide text-white mb-5 leading-[0.9] text-[clamp(3rem,2.2rem_+_4.5vw,6.5rem)] [@media(max-height:500px)]:mb-2 [@media(max-height:500px)]:text-[2.25rem]"
          >
            <span className="block text-brand-orange">SKATEHUBBA</span>
            <span className="block text-[clamp(1.2rem,0.8rem_+_2vw,2.5rem)] [@media(max-height:500px)]:text-lg">
              FOR THE LOVE OF THE GAME.
            </span>
          </h1>

          {/* Subtitle */}
          <p className="landing-sub font-body text-fluid-lg text-dim max-w-md leading-relaxed mb-10">
            S.K.A.T.E. over video. One take. No edits.
          </p>

          {/* Auth Buttons — Google is the primary path; email options sit
              below as a quieter secondary row so returning users still have
              an explicit "Sign in" entry without competing with the brand CTA. */}
          <div className="w-full max-w-sm flex flex-col gap-3">
            {appleOn ? <AppleButton onClick={handleApple} loading={appleLoading} disabled={googleLoading} /> : null}
            <GoogleButton onClick={handleGoogle} loading={googleLoading} disabled={appleOn && appleLoading} />
            <div
              className="flex items-center justify-center gap-2 text-faint"
              role="group"
              aria-label="Email sign-in options"
            >
              <button
                type="button"
                onClick={handleAuth("signin")}
                disabled={socialLoading}
                className="font-body text-sm text-dim hover:text-white px-3 py-2 min-h-[44px] rounded-md transition-colors duration-200 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              >
                Sign in
              </button>
              <span aria-hidden="true" className="text-xs">
                ·
              </span>
              <button
                type="button"
                onClick={handleAuth("signup")}
                disabled={socialLoading}
                className="font-body text-sm text-dim hover:text-white px-3 py-2 min-h-[44px] rounded-md transition-colors duration-200 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
              >
                Create account
              </button>
            </div>
            <TermsAgreementNotice onNav={onNav} />
          </div>
        </div>

        {/* Scroll indicator */}
        <a
          href="#demo"
          aria-label="Scroll to demo"
          className="absolute bottom-8 left-1/2 inline-flex min-h-11 min-w-11 -translate-x-1/2 items-center justify-center animate-scroll-hint rounded-full text-white/60 hover:text-white/85 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </a>
      </section>

      {/* ─── Demo Video ──────────────────────────────────── */}
      <section id="demo" aria-labelledby="demo-heading" className="max-w-5xl mx-auto px-6 py-16 md:py-24 scroll-mt-20">
        <h2 id="demo-heading" className="sr-only">
          Gameplay demo
        </h2>
        <div className="video-showcase">
          <div className="relative rounded-2xl overflow-hidden border border-white/[0.08] shadow-[0_0_80px_rgba(255,107,0,0.06),0_20px_60px_rgba(0,0,0,0.4)]">
            <LandingDemoVideo />
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
      <section
        id="how-it-works"
        aria-label="How it works"
        className="max-w-6xl mx-auto px-6 py-16 md:py-28 scroll-mt-20"
      >
        <div className="text-center mb-14 md:mb-20">
          <span className="font-display text-xs tracking-[0.3em] text-brand-orange/80 mb-3 block">THE DEAL</span>
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
                  className={`w-16 h-16 rounded-full flex items-center justify-center mb-5 relative z-10 ${item.circleClass}`}
                >
                  <span className={`font-display text-xl ${item.numClass}`}>{item.step}</span>
                </div>
                <h3 className="font-display text-xl text-white tracking-wide mb-2">{item.label}</h3>
                <p className="font-body text-sm text-faint leading-relaxed max-w-[260px]">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Game Preview / Phone Mockup ────────────────── */}
      <section id="game" aria-label="Game preview" className="max-w-6xl mx-auto px-6 py-16 md:py-28 scroll-mt-20">
        <div className="flex flex-col md:flex-row items-center gap-12 md:gap-20">
          {/* Phone mockup — purely decorative visual */}
          <div className="relative flex-shrink-0 animate-float" aria-hidden="true">
            <div className="w-[220px] h-[400px] md:w-[260px] md:h-[480px] rounded-[2.5rem] border border-white/[0.08] bg-[#111] overflow-hidden relative shadow-glass">
              {/* Dynamic Island */}
              <div className="absolute top-2.5 left-1/2 -translate-x-1/2 w-16 h-4 bg-background rounded-full z-10" />
              {/* Screen content */}
              <div className="absolute inset-3 top-8 rounded-2xl bg-[#0D0D0D] flex flex-col items-center justify-center gap-3 p-4">
                <span className="font-display text-xs tracking-[0.25em] text-brand-orange/80">GAME ON</span>
                <div className="flex gap-1.5">
                  {["S", "K", "A", "T", "E"].map((l, i) => (
                    <span
                      key={l}
                      className={`font-display text-xl ${
                        i < 2 ? "text-[#FF3D00] [text-shadow:0_0_8px_rgba(255,61,0,0.4)]" : "text-[#222]"
                      }`}
                    >
                      {l}
                    </span>
                  ))}
                </div>
                <div className="w-full h-20 rounded-lg bg-[#161616] border border-white/[0.04] flex items-center justify-center">
                  <span className="font-body text-xs text-[#8a8a8a]">trick video</span>
                </div>
                <div className="flex gap-2 w-full">
                  <div className="flex-1 h-8 rounded-lg bg-gradient-to-r from-brand-orange to-[#FF8533] flex items-center justify-center">
                    <span className="font-display text-[11px] text-white tracking-wider">LANDED</span>
                  </div>
                  <div className="flex-1 h-8 rounded-lg bg-[#161616] border border-white/[0.06] flex items-center justify-center">
                    <span className="font-display text-[11px] text-faint tracking-wider">MISSED</span>
                  </div>
                </div>
              </div>
            </div>
            {/* Glow */}
            <div className="absolute -inset-12 rounded-full bg-brand-orange/[0.06] blur-3xl -z-10" />
            <div className="absolute -inset-16 rounded-full bg-brand-orange/[0.03] blur-[80px] -z-20" />
          </div>

          {/* Text content */}
          <div className="flex-1 text-center md:text-left">
            <span className="font-display text-xs tracking-[0.3em] text-brand-orange/80 mb-4 block">THE GAME</span>
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
                "24 hours to 7 days per turn",
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
      <section id="features" aria-label="Features" className="max-w-6xl mx-auto px-6 py-16 md:py-28 scroll-mt-20">
        <div className="text-center mb-14 md:mb-20">
          <span className="font-display text-xs tracking-[0.3em] text-brand-orange/80 mb-3 block">WHAT YOU GET</span>
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
      <section id="cta" aria-labelledby="cta-heading" className="relative overflow-hidden scroll-mt-20">
        {/* Strong ambient glow */}
        <div className="absolute inset-0 pointer-events-none bg-cta-glow" />
        <div className="relative max-w-6xl mx-auto px-6 py-24 md:py-32 flex flex-col items-center text-center">
          <h2
            id="cta-heading"
            className="font-display text-white tracking-wider mb-4 leading-[0.95] text-[clamp(2rem,1.5rem_+_3vw,4.5rem)]"
          >
            QUIT SCROLLING.
          </h2>
          <p className="font-body text-dim mb-10 max-w-xs leading-relaxed">
            Board. Phone. That&apos;s all you need. Get in.
          </p>

          <div className="w-full max-w-sm animate-glow-pulse rounded-xl">
            <SkateButton onClick={handleAuth("signup")} disabled={socialLoading}>
              Start Playing
            </SkateButton>
          </div>

          <InviteButton className="w-full max-w-sm mt-6" />
        </div>
      </section>

      <LandingFooter onNav={onNav} />
    </div>
  );
}
