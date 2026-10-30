import { useEffect, type RefObject } from "react";
import { Group, Mesh, type Object3D, type WebGLRenderer } from "three";
import { skateparkModelUrl } from "../artSlots";
import { BOX_LENGTH } from "../constants";
import { fitParkPiece, type ParkFit } from "./parkFit";
import { disposeObject, loadRunnerModel } from "./skateboardModel";

/**
 * Sketchfab node names kept from Skatepark Obstacles. The suffix is the
 * file's own index. Grindable pieces replace the box mesh. Banks,
 * quarterpipes, and kickers sit on the sidewalk.
 */
export const LEDGE_NODE_NAMES = [
  "Funbox with Coping_14",
  "Funbox_62",
  "Funbox 2_59",
  "Table Top with Ledge 1_25",
  "Table Top with Ledge 2_24",
  "Table Top with Rail 1_23",
  "Table Top with Rail 2_22",
  "Hip with Ledge_58",
  "Hip with Ledge 2_41",
  "Rail 1_44",
  "Rail 1 High to Low_43",
  "Curved Rail 1_63",
  "Picnic bench_0",
] as const;

export const SCENERY_NODE_NAMES = [
  "3 Foot Bank_72",
  "4 Foot Bank with Railings_2",
  "2 Foot Quarterpipe _11",
  "3 Foot Quarterpipe_5",
  "2 Foot Kicker_56",
  "1 Foot Kicker_57",
] as const;

/** Lane-width cap so a funbox does not cover the next lane. Top stays near the grind. */
const LEDGE_FIT: ParkFit = { length: BOX_LENGTH, maxWidth: 1.25, maxHeight: 0.48, minWidth: 0.22 };

/** Sidewalk pieces stay between the curb and the brick wall. */
const SCENERY_FIT: ParkFit = { length: 3.2, maxWidth: 1.35, maxHeight: 1.65, minWidth: 0 };

const SCENERY_SPOTS: readonly (readonly [number, number])[] = [
  [-3.75, -12],
  [3.75, 8],
];

const BOX_FALLBACK = ["box-body", "box-wax", "box-coping"] as const;

let users = 0;
let generation = 0;
let shared: Promise<Object3D> | null = null;
let loaded: Object3D | null = null;

function acquireSkatepark(url: string, renderer: WebGLRenderer): Promise<Object3D> {
  users += 1;
  if (!shared) {
    const gen = generation;
    shared = loadRunnerModel(url, renderer)
      .then((scene) => {
        scene.name = "SkateparkObstacles";
        if (gen !== generation || users === 0) {
          disposeObject(scene);
          return scene;
        }
        loaded = scene;
        return scene;
      })
      .catch((error: unknown) => {
        if (gen === generation) shared = null;
        throw error;
      });
  }
  return shared;
}

function releaseSkatepark(): void {
  users -= 1;
  if (users > 0) return;
  generation += 1;
  const scene = loaded;
  loaded = null;
  shared = null;
  if (scene) disposeObject(scene);
}

/** Clone a named node with its Sketchfab parent transform baked in. */
function cloneBaked(piece: Object3D): Object3D {
  const copy = piece.clone(true);
  piece.updateWorldMatrix(true, true);
  copy.matrix.copy(piece.matrixWorld);
  copy.matrix.decompose(copy.position, copy.quaternion, copy.scale);
  return copy;
}

function paintShadows(root: Object3D, enabled: boolean): void {
  if (!enabled) return;
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

function setFallback(host: Object3D, names: readonly string[], visible: boolean): void {
  for (const name of names) {
    const part = host.getObjectByName(name);
    if (part) part.visible = visible;
  }
}

function mountPiece(parent: Object3D, piece: Object3D, fit: ParkFit, shadows: boolean): Group {
  const wrap = new Group();
  wrap.add(cloneBaked(piece));
  fitParkPiece(wrap, fit);
  paintShadows(wrap, shadows);
  parent.add(wrap);
  parent.visible = true;
  return wrap;
}

/**
 * One compressed skatepark file. Ledge nodes are cloned into box slots.
 * A failed load leaves the waxed box on screen. Grind length stays on the sim.
 */
export function useSkateparkLedges(slots: RefObject<(Group | null)[]>, renderer: WebGLRenderer): void {
  useEffect(() => {
    const url = skateparkModelUrl();
    if (!url) return;

    let cancelled = false;
    const mounts: Object3D[] = [];

    void acquireSkatepark(url, renderer)
      .then((scene) => {
        if (cancelled) return;
        slots.current.forEach((slot, index) => {
          const box = slot?.getObjectByName("box");
          const mount = box?.getObjectByName("box-model");
          const name = LEDGE_NODE_NAMES[index % LEDGE_NODE_NAMES.length];
          const piece = scene.getObjectByName(name);
          if (!box || !mount || !piece) return;
          mountPiece(mount, piece, LEDGE_FIT, renderer.shadowMap.enabled);
          setFallback(box, BOX_FALLBACK, false);
          mounts.push(mount);
        });
      })
      .catch((error: unknown) => {
        console.warn("Runner skatepark ledges failed to load", error);
      });

    return () => {
      cancelled = true;
      for (const mount of mounts) {
        const box = mount.parent;
        mount.clear();
        mount.visible = false;
        if (box) setFallback(box, BOX_FALLBACK, true);
      }
      releaseSkatepark();
    };
  }, [renderer, slots]);
}

/**
 * Banks, quarterpipes, and kickers on the sidewalk. They are not obstacles.
 * The curb-to-wall gap is the only place they are parented.
 */
export function useSkateparkScenery(root: RefObject<Group | null>, renderer: WebGLRenderer): void {
  useEffect(() => {
    const url = skateparkModelUrl();
    const slabs = root.current;
    if (!url || !slabs) return;

    let cancelled = false;
    const spawned: Object3D[] = [];

    void acquireSkatepark(url, renderer)
      .then((scene) => {
        if (cancelled) return;
        slabs.children.forEach((slab, slabIndex) => {
          const scenery = slab.getObjectByName("park-scenery");
          if (!scenery) return;
          SCENERY_SPOTS.forEach(([x, z], spotIndex) => {
            const name = SCENERY_NODE_NAMES[(slabIndex * SCENERY_SPOTS.length + spotIndex) % SCENERY_NODE_NAMES.length];
            const piece = scene.getObjectByName(name);
            if (!piece) return;
            const spot = new Group();
            spot.position.set(x, 0.06, z);
            mountPiece(spot, piece, SCENERY_FIT, renderer.shadowMap.enabled);
            scenery.add(spot);
            spawned.push(spot);
          });
        });
      })
      .catch((error: unknown) => {
        console.warn("Runner skatepark scenery failed to load", error);
      });

    return () => {
      cancelled = true;
      for (const spot of spawned) spot.removeFromParent();
      releaseSkatepark();
    };
  }, [renderer, root]);
}
