import boardLogoUrl from "./assets/board-logo.webp";

/**
 * The deck graphic and the logo decal are the SkateHubba mark (Design
 * Mainline LLC), one file used in both slots. Skateboard_01 and the Mike
 * White model stay null until those files are in the repo. Importing a
 * missing file fails the build.
 *
 * - Deck graphic and logo: src/runner/assets/board-logo.webp
 * - Skateboard_01: src/runner/assets/skateboard-01.glb
 * - Mike White board: src/runner/assets/mike-white-board.glb
 *
 * `Graphic` is the underside of the deck. `LogoDecal` is the small top
 * mark. Skateboard_01 is loaded by `loadSkateboardModel` (Draco, Meshopt,
 * KTX2, WebP). A null model URL keeps the procedural board and does not
 * fetch decoders. The Mike White model is a later slot and is not loaded
 * by that path.
 */

export const CUSTOM_BOARD_GRAPHIC: string | null = boardLogoUrl;
export const CUSTOM_LOGO_DECAL: string | null = boardLogoUrl;
export const MIKE_WHITE_BOARD: string | null = null;

/** Compressed Skateboard_01 glb. Null until Jason's download is in the repo. */
export const SKATEBOARD_01_MODEL: string | null = null;

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
