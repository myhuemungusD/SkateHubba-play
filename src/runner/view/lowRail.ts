import { useEffect, type RefObject } from "react";
import { Mesh, type Group, type Material, type MeshStandardMaterial, type Object3D, type WebGLRenderer } from "three";
import { lowRailModelUrl } from "../artSlots";
import { RAIL_LENGTH } from "../constants";
import { fitSkateboard, loadRunnerModel } from "./skateboardModel";

const MAP_KEYS = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap"] as const;

function hideFallback(rail: Object3D): void {
  for (const name of ["rail-beam", "rail-post-near", "rail-post-far"]) {
    const part = rail.getObjectByName(name);
    if (part) part.visible = false;
  }
}

function showFallback(rail: Object3D): void {
  for (const name of ["rail-beam", "rail-post-near", "rail-post-far"]) {
    const part = rail.getObjectByName(name);
    if (part) part.visible = true;
  }
}

function disposeMaterials(root: Object3D): void {
  const materials = new Set<Material>();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) materials.add(material);
  });
  for (const material of materials) material.dispose();
}

function disposeSource(root: Object3D): void {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    obj.geometry.dispose();
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) {
      for (const key of MAP_KEYS) {
        const texture = (material as MeshStandardMaterial)[key];
        texture?.dispose();
      }
      material.dispose();
    }
  });
}

/**
 * One compressed low rail, cloned into each pool slot. A failed load leaves
 * the box rail on screen. Grind length still comes from the sim.
 */
export function useLowRail(slots: RefObject<(Group | null)[]>, renderer: WebGLRenderer): void {
  useEffect(() => {
    const url = lowRailModelUrl();
    if (!url) return;

    let cancelled = false;
    const mounts: Object3D[] = [];
    let source: Object3D | null = null;

    void loadRunnerModel(url, renderer)
      .then((loaded) => {
        if (cancelled) {
          disposeSource(loaded);
          return;
        }
        fitSkateboard(loaded, false, RAIL_LENGTH);
        loaded.name = "LowRail";
        source = loaded;
        for (const slot of slots.current) {
          const rail = slot?.getObjectByName("rail");
          const mount = rail?.getObjectByName("rail-model");
          if (!rail || !mount) continue;
          const copy = loaded.clone(true);
          if (renderer.shadowMap.enabled) {
            copy.traverse((obj) => {
              if (obj instanceof Mesh) {
                obj.castShadow = true;
                obj.receiveShadow = true;
              }
            });
          }
          mount.add(copy);
          mount.visible = true;
          hideFallback(rail);
          mounts.push(mount);
        }
      })
      .catch((error: unknown) => {
        console.warn("Runner low rail failed to load", error);
      });

    return () => {
      cancelled = true;
      for (const mount of mounts) {
        const rail = mount.parent;
        const copy = mount.children[0];
        if (copy) {
          mount.remove(copy);
          disposeMaterials(copy);
        }
        mount.visible = false;
        if (rail) showFallback(rail);
      }
      if (source) disposeSource(source);
    };
  }, [renderer, slots]);
}
