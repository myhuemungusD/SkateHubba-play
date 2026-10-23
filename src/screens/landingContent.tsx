import { VideoIcon, ClockIcon, FlameIcon, ShieldIcon, TrophyIcon, UsersIcon } from "../components/icons";

/* Static marketing copy for the landing page. */

const BRAND_ICON_CLASS = "text-brand-orange";

// Per-step circle styling is expressed as Tailwind utility classes (literal
// arbitrary values) rather than inline styles so the CSP `style-src` can drop
// `'unsafe-inline'`. The colors here mirror the previous inline values
// (#FF6B00 / #FF8533 / #FFA366) with their original alpha suffixes.
export const HOW_IT_WORKS = [
  {
    step: "01",
    label: "Film It",
    desc: "One take. One chance. Land your trick on camera or don't bother.",
    circleClass:
      "bg-[radial-gradient(circle,#FF6B0018,#FF6B0008)] border border-[#FF6B0025] shadow-[0_0_30px_#FF6B0010]",
    numClass: "text-[#FF6B00]",
  },
  {
    step: "02",
    label: "Send the Challenge",
    desc: "Call out your opponent. They got till the clock runs out (24 hours to 7 days) to match it or eat a letter.",
    circleClass:
      "bg-[radial-gradient(circle,#FF853318,#FF853308)] border border-[#FF853325] shadow-[0_0_30px_#FF853310]",
    numClass: "text-[#FF8533]",
  },
  {
    step: "03",
    label: "Spell It Out",
    desc: "Miss the trick, take the letter. S-K-A-T-E and you're done.",
    circleClass:
      "bg-[radial-gradient(circle,#FFA36618,#FFA36608)] border border-[#FFA36625] shadow-[0_0_30px_#FFA36610]",
    numClass: "text-[#FFA366]",
  },
] as const;

export const FEATURES = [
  {
    icon: <VideoIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "One Take",
    desc: "No editing. No do-overs. You film it, it counts. Period.",
  },
  {
    icon: <ClockIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "Your Clock",
    desc: "Play when you want. Pick 24 hours, 3 days or 7 days a turn to get out there and film.",
  },
  {
    icon: <FlameIcon size={24} className={BRAND_ICON_CLASS} />,
    title: "No Farming",
    desc: "Rewards cap out at 3 games a day against the same skater. Want to climb? Take on somebody new.",
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
