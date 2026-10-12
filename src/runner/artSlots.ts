/**
 * Later art from Jason and Mike White. These stay null until the files
 * exist in the repo. Importing a missing file fails the build, so the
 * paths below are documentation until then.
 *
 * - Deck graphic: src/runner/assets/board-graphic.webp
 * - Logo decal: src/runner/assets/board-logo.webp
 * - Mike White board: src/runner/assets/mike-white-board.glb
 *
 * Wire a file by importing its URL and returning that string. The view
 * already has Graphic and LogoDecal meshes. The Mike White model parents
 * under the posed group in Board.tsx; hide the procedural meshes when it
 * arrives. Load it with three's GLTFLoader or `@react-three/drei/core/Gltf`,
 * not the drei package root.
 */

export const CUSTOM_BOARD_GRAPHIC: string | null = null;
export const CUSTOM_LOGO_DECAL: string | null = null;
export const MIKE_WHITE_BOARD: string | null = null;

export function customBoardGraphicUrl(): string | null {
  return CUSTOM_BOARD_GRAPHIC;
}

export function customLogoDecalUrl(): string | null {
  return CUSTOM_LOGO_DECAL;
}

export function mikeWhiteBoardUrl(): string | null {
  return MIKE_WHITE_BOARD;
}
