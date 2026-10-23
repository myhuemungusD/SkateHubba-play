import { SOCIAL_LINKS } from "../../constants/socialLinks";
import { ROW_CLASS, RowBody, SettingsGroup } from "./SettingsPrimitives";

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
    <SettingsGroup>
      {LINKS.map((l) => (
        <a key={l.title} href={l.href} target="_blank" rel="noopener noreferrer" className={ROW_CLASS}>
          <RowBody title={l.title} sub={l.sub} />
        </a>
      ))}
    </SettingsGroup>
  );
}
