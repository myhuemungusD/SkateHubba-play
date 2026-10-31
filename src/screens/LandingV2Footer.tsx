import { PlaceholderIcon } from "../components/PlaceholderIcon";
import { SOCIAL_MARKS, SocialMark } from "../components/SocialMarks";
import type { LegalScreen } from "./Landing";

const LEGAL: ReadonlyArray<{ screen: LegalScreen; label: string }> = [
  { screen: "privacy", label: "Privacy" },
  { screen: "terms", label: "Terms" },
  { screen: "datadeletion", label: "Data Deletion" },
];

const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ct-chalk";

/** Landing v2 footer: wordmark, social marks, legal links, content rule. */
export function LandingV2Footer({ onNav }: { onNav: (screen: LegalScreen) => void }) {
  return (
    <footer className="border-t border-ct-line">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
        <span className="inline-flex items-center gap-1 font-display text-xl tracking-[0.01em] text-ct-ash">
          <img
            src="/logonew.webp"
            alt=""
            aria-hidden="true"
            width={300}
            height={200}
            draggable={false}
            loading="lazy"
            decoding="async"
            className="-mx-2 h-9 w-auto select-none"
          />
          SKATEHUBBA
        </span>

        <ul className="-mx-3 flex items-center gap-1" aria-label="Social media">
          {SOCIAL_MARKS.map((mark) => (
            <li key={mark.name}>
              <a
                href={mark.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={mark.label}
                className={`inline-flex h-11 w-11 items-center justify-center rounded-ct text-ct-dust transition-colors duration-[120ms] ease-ct hover:text-ct-chalk ${FOCUS}`}
              >
                {mark.name === "store" ? (
                  <PlaceholderIcon name="icon-shop" size={20} />
                ) : (
                  <SocialMark name={mark.name} size={20} />
                )}
              </a>
            </li>
          ))}
        </ul>

        <nav aria-label="Legal" className="-mx-2 flex flex-wrap gap-x-2">
          {LEGAL.map((l) => (
            <button
              key={l.screen}
              type="button"
              onClick={() => onNav(l.screen)}
              className={`inline-flex min-h-11 items-center rounded-ct px-2 font-body text-sm text-ct-dust hover:text-ct-chalk hover:underline ${FOCUS}`}
            >
              {l.label}
            </button>
          ))}
        </nav>
      </div>
      <p className="mx-auto max-w-6xl px-4 pb-10 font-body text-xs text-ct-ash sm:px-6">
        Zero tolerance for objectionable content or abusive users.
      </p>
    </footer>
  );
}
