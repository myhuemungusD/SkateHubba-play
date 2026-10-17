/**
 * Skate sound effects. Every file is an ORIGINAL synthesized sound generated
 * by scripts/generate-skate-sfx.mjs and released under CC0 by the project —
 * no third-party samples. Credits: public/editor/CREDITS.md.
 */
export type SfxCategory = "board" | "grind" | "slide" | "roll" | "crowd";

export interface SkateSound {
  id: string;
  label: string;
  category: SfxCategory;
  /** Path under public/. */
  src: string;
  durationSec: number;
}

const s = (id: string, label: string, category: SfxCategory, durationSec: number): SkateSound => ({
  id,
  label,
  category,
  src: `/editor/sfx/${id}.m4a`,
  durationSec,
});

export const SKATE_SOUNDS: readonly SkateSound[] = [
  s("ollie-pop", "Ollie pop", "board", 0.35),
  s("flick", "Flick", "board", 0.25),
  s("landing", "Landing", "board", 0.6),
  s("grind-5050", "50-50 grind", "grind", 1.5),
  s("grind-crooked", "Crooked grind", "grind", 1.5),
  s("grind-smith", "Smith grind", "grind", 1.5),
  s("slide-wood", "Slide — wood", "slide", 1.2),
  s("slide-concrete", "Slide — concrete", "slide", 1.2),
  s("slide-metal", "Slide — metal", "slide", 1.2),
  s("wheel-roll", "Wheel roll", "roll", 3),
  s("powerslide", "Powerslide", "roll", 1),
  s("bail", "Bail", "board", 0.9),
  s("crowd-hype", "Crowd hype", "crowd", 2.5),
];

export function getSound(id: string): SkateSound | undefined {
  return SKATE_SOUNDS.find((x) => x.id === id);
}
