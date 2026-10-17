import boardLogoUrl from "./assets/board-logo.webp";
import lowRailUrl from "./assets/low-rail.glb?url";
import skateboardUrl from "./assets/skateboard-01.glb?url";
import skateparkUrl from "./assets/skatepark-obstacles.glb?url";

/**
 * The deck graphic and the logo decal are the SkateHubba mark (Design
 * Mainline LLC). Skateboard_01 and the low rail are the compressed glbs.
 * The Mike White model stays null until that file is in the repo.
 * Importing a missing file fails the build.
 *
 * - Deck graphic and logo: src/runner/assets/board-logo.webp
 * - Skateboard_01: src/runner/assets/skateboard-01.glb
 * - Low rail: src/runner/assets/low-rail.glb
 * - Skatepark obstacles: src/runner/assets/skatepark-obstacles.glb
 * - Mike White board: src/runner/assets/mike-white-board.glb
 *
 * `Graphic` is the underside plane. It stays in the rig when Skateboard_01
 * replaces the procedural deck, so the logo slot can still swap that
 * graphic. `LogoDecal` is the small top mark on the procedural deck.
 * A null model URL keeps the fallback mesh and does not fetch decoders.
 */

export const CUSTOM_BOARD_GRAPHIC: string | null = boardLogoUrl;
export const CUSTOM_LOGO_DECAL: string | null = boardLogoUrl;
export const MIKE_WHITE_BOARD: string | null = null;

/** Compressed Skateboard_01 glb. */
export const SKATEBOARD_01_MODEL: string | null = skateboardUrl;

/** Compressed Low Rail glb. */
export const LOW_RAIL_MODEL: string | null = lowRailUrl;

/** Compressed Skatepark Obstacles glb. Spec-gloss is already metal-rough. */
export const SKATEPARK_MODEL: string | null = skateparkUrl;

/** Set true if the file's nose points toward +Z after the fit. */
export const SKATEBOARD_01_NOSE_FLIP = false;

export function customBoardGraphicUrl(): string | null {
  return CUSTOM_BOARD_GRAPHIC;
}

export function customLogoDecalUrl(): string | null {
  return CUSTOM_LOGO_DECAL;
}

export function mikeWhiteBoardUrl(): string | null {
  return MIKE_WHITE_BOARD;
}

export function skateboard01ModelUrl(): string | null {
  return SKATEBOARD_01_MODEL;
}

export function lowRailModelUrl(): string | null {
  return LOW_RAIL_MODEL;
}

export function skateparkModelUrl(): string | null {
  return SKATEPARK_MODEL;
}
