import { DeckButton } from "../components/DeckButton";
import { PlaceholderIcon, type PlaceholderIconName } from "../components/PlaceholderIcon";

/* Landing v2 "Concrete & Tape" body sections (UX audit D3). Copy is final;
   icons are named slots until Jason's SVGs land. */

const STEPS = [
  { n: "01", title: "FILM IT", body: "One continuous take. Land it on camera." },
  { n: "02", title: "SEND IT", body: "Your opponent has 24 hours to 7 days to match it." },
  { n: "03", title: "SPELL IT OUT", body: "Miss and you take a letter. S-K-A-T-E and you're out." },
] as const;

const FEATURES: ReadonlyArray<{ icon: PlaceholderIconName; title: string; body: string }> = [
  {
    icon: "icon-record",
    title: "ONE TAKE",
    body: "No cuts, no slow-mo, no retries. What they see is what happened.",
  },
  { icon: "icon-clock", title: "YOUR CLOCK", body: "Pick 24 hours, 3 days or 7 days a turn." },
  {
    icon: "icon-rank",
    title: "EARN YOUR RANK",
    body: "Wins count. Farming the same skater doesn't. Rewards cap at 3 games a day per opponent.",
  },
  { icon: "icon-crew", title: "ANYONE, ANYWHERE", body: "Your crew across town or a stranger across the world." },
];

const SECTION = "mx-auto max-w-6xl px-4 pt-16 sm:px-6 lg:pt-24";
const H2 = "font-display text-[2rem] leading-none tracking-[0.01em] text-ct-chalk lg:text-5xl";
const H3 = "font-display text-2xl leading-none tracking-[0.01em] text-ct-chalk";
const BODY = "mt-2 font-body text-base leading-relaxed text-ct-dust";

export function LandingV2HowItWorks() {
  return (
    <section aria-labelledby="lv2-how" className={SECTION}>
      <h2 id="lv2-how" className={H2}>
        HOW IT WORKS
      </h2>
      <ol className="mt-8 grid gap-8 md:grid-cols-3 md:gap-6">
        {STEPS.map((s) => (
          <li key={s.n} className="flex gap-4 md:flex-col">
            <span
              aria-hidden="true"
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-ct-media border border-ct-line-strong font-mono text-[2rem] leading-none text-ct-hubba"
            >
              {s.n}
            </span>
            <div>
              <h3 className={H3}>{s.title}</h3>
              <p className={BODY}>{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function LandingV2Features() {
  return (
    <section aria-labelledby="lv2-features" className={SECTION}>
      <h2 id="lv2-features" className={H2}>
        NO EDITS. NO EXCUSES.
      </h2>
      <ul className="mt-8 grid border-b border-ct-line md:grid-cols-2 md:gap-x-12">
        {FEATURES.map((f) => (
          <li key={f.title} className="flex gap-4 border-t border-ct-line py-6">
            <PlaceholderIcon name={f.icon} className="mt-0.5 shrink-0 text-ct-hubba" />
            <div>
              <h3 className={H3}>{f.title}</h3>
              <p className={BODY}>{f.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LandingV2Cta({ onStart, disabled }: { onStart: () => void; disabled: boolean }) {
  return (
    <section aria-labelledby="lv2-cta" className={`${SECTION} pb-16 lg:pb-24`}>
      <div className="flex flex-col items-start gap-4 md:items-center md:text-center">
        <h2 id="lv2-cta" className="font-display text-5xl leading-none tracking-[0.01em] text-ct-chalk lg:text-7xl">
          YOUR TURN.
        </h2>
        <p className="font-body text-base text-ct-dust lg:text-xl">Free. All you need is a board and a phone.</p>
        <div className="mt-4 w-full max-w-sm">
          <DeckButton onClick={onStart} disabled={disabled}>
            START PLAYING
          </DeckButton>
        </div>
      </div>
    </section>
  );
}
