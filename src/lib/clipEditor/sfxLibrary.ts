/**
 * Skate sound effects. Sounds with `credit` are real recordings cut from
 * Freesound 746602 "Skateboarding Tricks" by SoundBiterSFX (CC BY 4.0) by
 * scripts/process-recorded-sfx.sh; the rest are original synthesized sounds
 * from scripts/generate-skate-sfx.mjs (CC0). Credits: public/editor/CREDITS.md
 * and the in-editor credits line (SoundsPanel).
 */
export type SfxCategory = "board" | "grind" | "slide" | "roll" | "crowd";

export interface SkateSound {
  id: string;
  label: string;
  category: SfxCategory;
  /** Path under public/. */
  src: string;
  durationSec: number;
  /** Ogg Vorbis copy (recorded sounds only), for browsers without AAC. */
  oggSrc?: string;
  /** Attribution for third-party recordings; absent means original synthesis. */
  credit?: SoundCredit;
}

export interface SoundCredit {
  author: string;
  title: string;
  url: string;
  license: string;
}

export const SOUNDBITER_CREDIT: SoundCredit = {
  author: "SoundBiterSFX",
  title: "Skateboarding Tricks",
  url: "https://freesound.org/s/746602/",
  license: "CC BY 4.0",
};

const s = (id: string, label: string, category: SfxCategory, durationSec: number): SkateSound => ({
  id,
  label,
  category,
  src: `/editor/sfx/${id}.m4a`,
  durationSec,
});

/** A real recording cut from SoundBiterSFX's "Skateboarding Tricks". */
const r = (id: string, label: string, category: SfxCategory, durationSec: number): SkateSound => ({
  ...s(id, label, category, durationSec),
  oggSrc: `/editor/sfx/${id}.ogg`,
  credit: SOUNDBITER_CREDIT,
});

export const SKATE_SOUNDS: readonly SkateSound[] = [
  r("ollie-pop", "Ollie pop", "board", 0.3),
  r("flick", "Flick", "board", 0.16),
  r("landing", "Landing", "board", 0.9),
  r("grind-5050", "50-50 grind", "grind", 1.7),
  s("grind-crooked", "Crooked grind", "grind", 1.5),
  s("grind-smith", "Smith grind", "grind", 1.5),
  s("slide-wood", "Slide — wood", "slide", 1.2),
  r("slide-concrete", "Slide — concrete", "slide", 0.56),
  s("slide-metal", "Slide — metal", "slide", 1.2),
  r("wheel-roll", "Wheel roll", "roll", 2),
  r("powerslide", "Powerslide", "roll", 0.7),
  s("bail", "Bail", "board", 0.9),
  s("crowd-hype", "Crowd hype", "crowd", 2.5),
];

export function getSound(id: string): SkateSound | undefined {
  return SKATE_SOUNDS.find((x) => x.id === id);
}

/** Distinct credits for every third-party recording in the library. */
export function soundCredits(): SoundCredit[] {
  const seen = new Map<string, SoundCredit>();
  for (const x of SKATE_SOUNDS) if (x.credit) seen.set(x.credit.url, x.credit);
  return [...seen.values()];
}
