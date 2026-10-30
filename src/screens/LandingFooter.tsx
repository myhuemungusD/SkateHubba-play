import { SOCIAL_MARKS, SocialMark } from "../components/SocialMarks";
import type { LegalScreen } from "./Landing";

/** Landing page footer: social links, legal links and copyright. */
export function LandingFooter({ onNav }: { onNav: (screen: LegalScreen) => void }) {
  return (
    <footer className="border-t border-white/[0.05]">
      <div className="max-w-6xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="flex flex-col items-center md:items-start gap-1.5">
          <img
            src="/logonew.webp"
            alt=""
            width={1536}
            height={1024}
            draggable={false}
            loading="lazy"
            decoding="async"
            className="h-6 w-auto select-none opacity-40"
            aria-hidden="true"
          />
          <span className="font-body text-xs text-[#888]">For the love of the game.</span>
        </div>

        {/* Social Links */}
        <div className="flex gap-4 items-center" aria-label="Social media">
          {SOCIAL_MARKS.map((mark) => (
            <a
              key={mark.name}
              href={mark.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#a3a3a3] hover:text-white transition-colors duration-200"
              aria-label={mark.label}
            >
              <SocialMark name={mark.name} />
            </a>
          ))}
        </div>

        <nav className="flex gap-5 flex-wrap justify-center" aria-label="Legal">
          <button
            type="button"
            onClick={() => onNav("privacy")}
            className="inline-flex min-h-11 items-center font-body text-xs text-[#b5b5b5] hover:text-white transition-colors duration-200"
          >
            Privacy
          </button>
          <button
            type="button"
            onClick={() => onNav("terms")}
            className="inline-flex min-h-11 items-center font-body text-xs text-[#b5b5b5] hover:text-white transition-colors duration-200"
          >
            Terms
          </button>
          <button
            type="button"
            onClick={() => onNav("datadeletion")}
            className="inline-flex min-h-11 items-center font-body text-xs text-[#b5b5b5] hover:text-white transition-colors duration-200"
          >
            Data Deletion
          </button>
        </nav>
      </div>
    </footer>
  );
}
