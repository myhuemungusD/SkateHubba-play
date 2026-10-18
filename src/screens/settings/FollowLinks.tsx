import { SOCIAL_LINKS } from "../../constants/socialLinks";

const CARD =
  "block p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange";

const LINKS = [
  { href: SOCIAL_LINKS.store, title: "Shop the Store", sub: "Decks, tees, and more at skatehubba.store." },
  { href: SOCIAL_LINKS.tiktok, title: "TikTok", sub: "@skatehubba_app" },
  { href: SOCIAL_LINKS.instagram, title: "Instagram", sub: "@skatehubba_app" },
  { href: SOCIAL_LINKS.facebook, title: "Facebook", sub: "SkateHubba on Facebook" },
  { href: SOCIAL_LINKS.x, title: "X", sub: "@skatehubba_" },
];

/** Settings → Follow SkateHubba: official accounts plus the Shopify store. */
export function FollowLinks() {
  return (
    <div className="space-y-2">
      {LINKS.map((l) => (
        <a key={l.title} href={l.href} target="_blank" rel="noopener noreferrer" className={CARD}>
          <p className="font-display text-sm text-white tracking-wide">{l.title}</p>
          <p className="font-body text-xs text-faint mt-1">{l.sub}</p>
        </a>
      ))}
    </div>
  );
}
