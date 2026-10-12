/**
 * Later art from Jason and Mike White. These stay null until the files
 * exist in the repo. Importing a missing file fails the build, so the
 * paths below are documentation until then.
 *
 * - Deck graphic: src/runner/assets/board-graphic.webp
 * - Logo decal: src/runner/assets/board-logo.webp
 * - Skateboard_01: src/runner/assets/skateboard-01.glb
 * - Mike White board: src/runner/assets/mike-white-board.glb
 *
 * Wire a file by importing its URL and returning that string. The view
 * already has Graphic and LogoDecal meshes. Skateboard_01 is loaded by
 * `loadSkateboardModel` (Draco, Meshopt, KTX2, WebP). A null URL keeps the
 * procedural board and does not fetch decoders. The Mike White model is a
 * later slot and is not loaded by that path.
 */

export const CUSTOM_BOARD_GRAPHIC: string | null = null;
export const CUSTOM_LOGO_DECAL: string | null = null;
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
