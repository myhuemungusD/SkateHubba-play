import { MIKE_WHITE_DESIGNER } from "./closet/mikeWhiteCollection";

/** App credits (Settings → Credits). Keep designer credits here so they show everywhere the app lists credits. */
export interface AppCredit {
  who: string;
  what: string;
}

export const APP_CREDITS: readonly AppCredit[] = [
  {
    who: MIKE_WHITE_DESIGNER,
    what: "Mike White Signature collection and the Closet Studio starter templates. Designs made from them are credited “Based on a Mike White design”.",
  },
  { who: "SoundBiterSFX", what: "Recorded skate sound effects (CC BY 4.0) in the clip editor." },
];
