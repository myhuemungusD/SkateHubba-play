import { MIKE_WHITE_DESIGNER } from "./closet/mikeWhiteCollection";
import { LOW_RAIL_CREDIT, SKATEBOARD_01_CREDIT, SKATEPARK_CREDIT } from "../runner/boardCredit";

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
  // The 3D models ship in the app bundle, so their CC BY 4.0 attribution is
  // listed here verbatim from each license.txt (docs/RUNNER_ASSETS.md).
  { who: "rhcreations", what: SKATEPARK_CREDIT },
  { who: "CrazyScans", what: SKATEBOARD_01_CREDIT },
  { who: "bralunit", what: LOW_RAIL_CREDIT },
  // CC0 needs no attribution; credited anyway.
  { who: "Poly Haven", what: "“sunset_jhbcentral” HDRI (CC0)." },
  { who: "ambientCG", what: "Asphalt, concrete, metal and brick textures (CC0)." },
];
