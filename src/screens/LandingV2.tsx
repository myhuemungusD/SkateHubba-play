import type { MouseEvent } from "react";
import { AppleButton } from "../components/AppleButton";
import { GoogleButton } from "../components/GoogleButton";
import { LandingDemoVideo } from "../components/LandingDemoVideo";
import type { LegalDoc } from "../components/legal/TermsAgreementNotice";
import { isAppleSignInEnabled } from "../lib/featureFlags";
import type { LandingProps } from "./Landing";
import { LandingV2Cta, LandingV2Features, LandingV2HowItWorks } from "./LandingV2Sections";
import { LandingV2Footer } from "./LandingV2Footer";

/* Landing v2 "Concrete & Tape" (UX audit Part D, behind VITE_FEATURE_LANDING_V2).
   Flat ink page, one wall photo as the wordmark, no motion until a press. */

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ct-chalk";
const WALL = "/sh-graffiti.webp";
/** Tile width per breakpoint; the -mt offsets center the painted SKATE HUBBA in the band. */
const TILE = "w-[480px] max-w-none sm:w-[620px] lg:w-[740px]";
/** Side panels: the tag-covered top of the wall, scaled so the band never reaches the lettering. */
const FLANK = "hidden w-[1200px] max-w-none -scale-x-100 sm:block";

/**
 * The graffiti wall is the brand mark here. It sits in its own band with no
 * text over it, so it can run at full strength. Wider screens mirror the
 * photo on both sides so the wall reads as one continuous surface.
 */
function Wall() {
  return (
    <div
      data-testid="landing-v2-wall"
      className="relative h-[220px] overflow-hidden border-b border-ct-line bg-ct-ink sm:h-[300px] lg:h-[360px]"
    >
      <div className="absolute left-1/2 top-0 flex -translate-x-1/2 items-start">
        <img src={WALL} alt="" aria-hidden="true" width={768} height={1152} className={FLANK} />
        <img
          src={WALL}
          alt="SkateHubba painted on a graffiti wall"
          width={768}
          height={1152}
          fetchPriority="high"
          className={`${TILE} -mt-[156px] sm:-mt-[194px] lg:-mt-[231px]`}
        />
        <img src={WALL} alt="" aria-hidden="true" width={768} height={1152} className={FLANK} />
      </div>
    </div>
  );
}

function TermsLine({ onNav }: { onNav: (doc: LegalDoc) => void }) {
  const link = (doc: LegalDoc, label: string) => (
    <a
      href={`/${doc}`}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        e.preventDefault();
        onNav(doc);
      }}
      className={`rounded-ct text-ct-dust underline underline-offset-2 hover:text-ct-chalk ${FOCUS}`}
    >
      {label}
    </a>
  );
  return (
    <p data-testid="terms-agreement-notice" className="font-body text-xs leading-relaxed text-ct-ash">
      By continuing you agree to our {link("terms", "Terms")} and {link("privacy", "Privacy Policy")}.
    </p>
  );
}

export function LandingV2({ onGo, onGoogle, googleLoading, onApple, appleLoading, onNav }: LandingProps) {
  const appleOn = isAppleSignInEnabled();
  const socialLoading = googleLoading || (appleOn && appleLoading);

  return (
    <div data-testid="landing-v2" className="min-h-dvh bg-ct-ink font-body text-ct-chalk">
      <header className="sticky top-below-overlay z-40 border-b border-ct-line bg-ct-ink pt-safe-inset">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <a href="/" aria-label="SkateHubba home" className={`-ml-1 inline-flex min-h-11 items-center rounded-ct px-1 font-display text-2xl tracking-[0.01em] ${FOCUS}`}>
            SKATEHUBBA
          </a>
          <button
            type="button"
            onClick={() => onGo("signin")}
            className={`-mr-2 inline-flex min-h-11 items-center rounded-ct px-2 text-sm font-semibold text-ct-dust hover:text-ct-chalk hover:underline ${FOCUS}`}
          >
            Sign in
          </button>
        </div>
      </header>

      <div>
        <section aria-labelledby="lv2-title">
          <Wall />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 pt-6 sm:px-6 lg:grid-cols-2 lg:gap-12 lg:pt-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ct-dust">S.K.A.T.E. over video</p>
              <h1
                id="lv2-title"
                className="mt-3 font-display text-5xl leading-[0.95] tracking-[0.01em] text-ct-chalk lg:text-7xl"
              >
                FOR THE LOVE OF THE GAME.
              </h1>
              <p className="mt-3 max-w-md text-base text-ct-dust lg:mt-4 lg:text-xl">
                Film your trick. Send it. They match it or take a letter.
              </p>
              <div className="mt-6 flex max-w-sm flex-col gap-3">
                <GoogleButton shape="flat" onClick={onGoogle} loading={googleLoading} disabled={socialLoading} />
                {appleOn && <AppleButton shape="flat" onClick={onApple} loading={appleLoading} disabled={socialLoading} />}
                <button
                  type="button"
                  onClick={() => onGo("signin")}
                  className={`inline-flex min-h-11 items-center justify-center rounded-ct text-base text-ct-dust hover:text-ct-chalk hover:underline ${FOCUS}`}
                >
                  Use email instead
                </button>
                <TermsLine onNav={onNav} />
              </div>
            </div>
            <figure className="w-full">
              <div className="overflow-hidden rounded-ct-media border border-ct-line">
                <LandingDemoVideo />
              </div>
              <figcaption className="mt-3 flex items-center gap-2 font-mono text-xs text-ct-dust">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-ct-bail" />
                REAL GAME · ONE TAKE
              </figcaption>
            </figure>
          </div>
        </section>

        <LandingV2HowItWorks />
        <LandingV2Features />
        <LandingV2Cta onStart={() => onGo("signup")} disabled={socialLoading} />
      </div>

      <LandingV2Footer onNav={onNav} />
    </div>
  );
}
