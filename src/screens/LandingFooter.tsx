import { SOCIAL_LINKS } from "../constants/socialLinks";
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
          <a
            href={SOCIAL_LINKS.x}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#a3a3a3] hover:text-white transition-colors duration-200"
            aria-label="Follow on X"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
          </a>
          <a
            href={SOCIAL_LINKS.instagram}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#a3a3a3] hover:text-white transition-colors duration-200"
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
            href={SOCIAL_LINKS.facebook}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#a3a3a3] hover:text-white transition-colors duration-200"
            aria-label="Follow on Facebook"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
            </svg>
          </a>
          <a
            href={SOCIAL_LINKS.tiktok}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#a3a3a3] hover:text-white transition-colors duration-200"
            aria-label="Follow on TikTok"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
            </svg>
          </a>
          <a
            href={SOCIAL_LINKS.store}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 min-w-11 items-center justify-center text-[#a3a3a3] hover:text-white transition-colors duration-200"
            aria-label="SkateHubba store"
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
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
              <line x1="3" y1="6" x2="21" y2="6" />
              <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
          </a>
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
