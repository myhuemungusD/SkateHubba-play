import { useEffect, type RefObject } from "react";
import { MeshStandardMaterial, SRGBColorSpace, TextureLoader, type Group, type Texture } from "three";
import { customBoardGraphicUrl, customLogoDecalUrl } from "../artSlots";
import { logger } from "../../services/logger";
import { errorLogFields } from "../../utils/errors";

function applyMap(root: Group, name: string, texture: Texture): boolean {
  const mesh = root.getObjectByName(name);
  if (!mesh || !("material" in mesh) || !(mesh.material instanceof MeshStandardMaterial)) {
    texture.dispose();
    return false;
  }
  texture.colorSpace = SRGBColorSpace;
  mesh.material.map = texture;
  mesh.material.color.set("#ffffff");
  mesh.material.emissive.set("#000000");
  mesh.material.needsUpdate = true;
  mesh.visible = true;
  return true;
}

/**
 * Paints Jason's deck graphic and logo when those slots are filled.
 * A null slot does not fetch anything.
 */
export function useCustomBoardArt(root: RefObject<Group | null>): void {
  useEffect(() => {
    const graphicUrl = customBoardGraphicUrl();
    const logoUrl = customLogoDecalUrl();
    const group = root.current;
    if (!group || (graphicUrl === null && logoUrl === null)) return;

    let cancelled = false;
    const textures: Texture[] = [];
    const loader = new TextureLoader();
    const jobs: Array<[string, string]> = [];
    if (graphicUrl !== null) jobs.push(["Graphic", graphicUrl]);
    if (logoUrl !== null) jobs.push(["LogoDecal", logoUrl]);

    for (const [name, url] of jobs) {
      void loader
        .loadAsync(url)
        .then((texture) => {
          if (cancelled) {
            texture.dispose();
            return;
          }
          if (applyMap(group, name, texture)) textures.push(texture);
        })
        .catch((error: unknown) => {
          logger.warn("runner_custom_art_load_failed", errorLogFields(error));
        });
    }

    return () => {
      cancelled = true;
      for (const texture of textures) texture.dispose();
    };
  }, [root]);
}
