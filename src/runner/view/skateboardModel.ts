import { useEffect, useRef, type RefObject } from "react";
import { useFrame } from "@react-three/fiber";
import {
  Box3,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NoColorSpace,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Texture,
  type WebGLRenderer,
} from "three";
import { SKATEBOARD_01_NOSE_FLIP, skateboard01ModelUrl } from "../artSlots";
import type { RunnerController } from "../controller";

/** Local length inside the posed group. That group is already scaled by 1.4. */
export const BOARD_TARGET_LENGTH = 1.9;

const DRACO_DECODER_PATH = "/runner/decoders/draco/";
const BASIS_TRANSCODER_PATH = "/runner/decoders/basis/";

const AXIS = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const MAP_KEYS = ["map", "emissiveMap", "normalMap", "roughnessMap", "metalnessMap", "aoMap"] as const;

function longestAxis(size: Vector3): number {
  const dims = [size.x, size.y, size.z];
  let index = 2;
  if (dims[0] > dims[index]) index = 0;
  if (dims[1] > dims[index]) index = 1;
  return index;
}

function thinnestAxis(size: Vector3, except: number): number {
  const dims = [size.x, size.y, size.z];
  let index = except === 1 ? 0 : 1;
  for (let i = 0; i < 3; i += 1) {
    if (i !== except && dims[i] < dims[index]) index = i;
  }
  return index;
}

function component(point: Vector3, axis: number): number {
  if (axis === 0) return point.x;
  if (axis === 1) return point.y;
  return point.z;
}

/**
 * Kicked nose and tail sit on the deck. Wheels sit in the middle of the
 * length. The positive thin-axis end is up only when that end reaches
 * farther toward the nose and tail.
 */
function deckUpSign(root: Object3D, thin: number, long: number): number {
  const samples: Vector3[] = [];
  const point = new Vector3();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const attr = obj.geometry.getAttribute("position");
    if (!attr) return;
    const step = Math.max(1, Math.floor(attr.count / 400));
    for (let i = 0; i < attr.count; i += step) {
      samples.push(point.fromBufferAttribute(attr, i).applyMatrix4(obj.matrixWorld).clone());
    }
  });
  if (samples.length < 8) return 1;

  let minThin = Infinity;
  let maxThin = -Infinity;
  let minLong = Infinity;
  let maxLong = -Infinity;
  for (const sample of samples) {
    const alongThin = component(sample, thin);
    const alongLong = component(sample, long);
    if (alongThin < minThin) minThin = alongThin;
    if (alongThin > maxThin) maxThin = alongThin;
    if (alongLong < minLong) minLong = alongLong;
    if (alongLong > maxLong) maxLong = alongLong;
  }
  const thinSpan = maxThin - minThin || 1;
  const longSpan = maxLong - minLong || 1;
  let positive = 0;
  let positiveCount = 0;
  let negative = 0;
  let negativeCount = 0;
  for (const sample of samples) {
    const alongThin = (component(sample, thin) - minThin) / thinSpan;
    const towardEnds = Math.abs((component(sample, long) - minLong) / longSpan - 0.5) * 2;
    if (alongThin > 0.75) {
      positive += towardEnds;
      positiveCount += 1;
    } else if (alongThin < 0.25) {
      negative += towardEnds;
      negativeCount += 1;
    }
  }
  const positiveScore = positiveCount > 0 ? positive / positiveCount : 0;
  const negativeScore = negativeCount > 0 ? negative / negativeCount : 0;
  return positiveScore >= negativeScore ? 1 : -1;
}

/**
 * Lay the model flat in the posed group. The longest axis points down the
 * street (-Z) unless `noseFlip` is set, and the deck side of the thinnest
 * axis points up. Uniform scale makes the length 1.9. The bottom sits on
 * the rig origin.
 */
export function fitSkateboard(root: Object3D, noseFlip = false, targetLength = BOARD_TARGET_LENGTH): void {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);
  root.updateMatrixWorld(true);

  const size = new Box3().setFromObject(root).getSize(new Vector3());
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) return;

  const forwardIndex = longestAxis(size);
  const upIndex = thinnestAxis(size, forwardIndex);
  const sourceForward = AXIS[forwardIndex].clone();
  const sourceUp = AXIS[upIndex].clone().multiplyScalar(deckUpSign(root, upIndex, forwardIndex));
  const sourceRight = new Vector3().crossVectors(sourceUp, sourceForward);
  const targetForward = new Vector3(0, 0, noseFlip ? 1 : -1);
  const targetUp = new Vector3(0, 1, 0);
  const targetRight = new Vector3().crossVectors(targetUp, targetForward);
  const sourceBasis = new Matrix4().makeBasis(sourceRight, sourceUp, sourceForward);
  const targetBasis = new Matrix4().makeBasis(targetRight, targetUp, targetForward);
  root.rotation.setFromRotationMatrix(new Matrix4().multiplyMatrices(targetBasis, sourceBasis.invert()));
  root.updateMatrixWorld(true);

  const fitted = new Box3().setFromObject(root).getSize(new Vector3());
  const length = targetLength > 0 ? targetLength : BOARD_TARGET_LENGTH;
  root.scale.setScalar(length / (fitted.z > 0 ? fitted.z : 1));
  root.updateMatrixWorld(true);

  const grounded = new Box3().setFromObject(root);
  const center = grounded.getCenter(new Vector3());
  root.position.set(-center.x, -grounded.min.y, -center.z);
  root.updateMatrixWorld(true);
}

/**
 * Nodes whose names contain "wheel", skipping a node when an ancestor is
 * already included. The board spins these on local X. A file with no such
 * name still rides; the wheels just do not roll.
 */
export function collectWheelNodes(root: Object3D): Object3D[] {
  const wheels: Object3D[] = [];
  root.traverse((obj) => {
    if (!/wheel/i.test(obj.name)) return;
    let ancestor = obj.parent;
    while (ancestor) {
      if (wheels.includes(ancestor)) return;
      ancestor = ancestor.parent;
    }
    wheels.push(obj);
  });
  return wheels;
}

function tuneMaterials(root: Object3D, anisotropy: number): void {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of materials) {
      for (const key of MAP_KEYS) {
        if (!(key in material)) continue;
        const texture = (material as MeshStandardMaterial)[key];
        if (!texture) continue;
        texture.colorSpace = key === "map" || key === "emissiveMap" ? SRGBColorSpace : NoColorSpace;
        texture.anisotropy = anisotropy;
        texture.needsUpdate = true;
      }
    }
  });
}

function disposeObject(root: Object3D): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    geometries.add(obj.geometry);
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const material of list) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) {
    for (const key of MAP_KEYS) {
      if (!(key in material)) continue;
      const texture = (material as MeshStandardMaterial)[key];
      if (texture) textures.add(texture);
    }
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
}

/**
 * Sit a unit plane on the deck underside so the graphic slot can replace
 * whatever art shipped in the file. `graphic` is a 1×1 plane in the same
 * rig as the fitted board.
 */
export function placeDeckGraphic(board: Object3D, graphic: Object3D): void {
  const size = new Box3().setFromObject(board).getSize(new Vector3());
  if (![size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0)) return;
  graphic.position.set(0, size.y * 0.56, 0);
  graphic.rotation.set(Math.PI / 2, 0, 0);
  graphic.scale.set(size.x * 0.7, size.z * 0.55, 1);
  graphic.visible = true;
}

function resetDeckGraphic(graphic: Object3D): void {
  graphic.position.set(0, 0.222, 0);
  graphic.rotation.set(Math.PI / 2, 0, 0);
  graphic.scale.set(0.48, 0.92, 1);
}

/** Draco, Meshopt, KTX2, and WebP. Imported only when a model URL is set. */
export async function loadRunnerModel(url: string, renderer: WebGLRenderer): Promise<Object3D> {
  const [{ GLTFLoader }, { DRACOLoader }, { KTX2Loader }, meshopt] = await Promise.all([
    import("three/examples/jsm/loaders/GLTFLoader.js"),
    import("three/examples/jsm/loaders/DRACOLoader.js"),
    import("three/examples/jsm/loaders/KTX2Loader.js"),
    import("three/examples/jsm/libs/meshopt_decoder.module.js"),
  ]);

  const draco = new DRACOLoader();
  draco.setDecoderPath(DRACO_DECODER_PATH);
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(BASIS_TRANSCODER_PATH);
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2);
  loader.setMeshoptDecoder(meshopt.MeshoptDecoder);

  try {
    await meshopt.MeshoptDecoder.ready;
    try {
      ktx2.detectSupport(renderer);
    } catch (error: unknown) {
      console.warn("Runner KTX2 support check failed", error);
    }
    const gltf = await loader.loadAsync(url);
    tuneMaterials(gltf.scene, Math.min(4, renderer.capabilities.getMaxAnisotropy()));
    return gltf.scene;
  } finally {
    draco.dispose();
    ktx2.dispose();
  }
}

const loadSkateboardModel = loadRunnerModel;

export function wheelSpinRate(state: { duck: number; onGrind: boolean; airborne?: boolean }): number {
  if (state.duck >= 0) return 0.35;
  if (state.onGrind) return 0.9;
  if (state.airborne) return 0.45;
  return 1.7;
}

/**
 * Parents Skateboard_01 under the posed group when the slot has a URL.
 * A null slot does not fetch. A failed load leaves ProceduralBoard visible.
 * Named wheels roll on local X from here, so the posed group does not
 * mutate a list this hook owns.
 */
export function useSkateboardModel(
  root: RefObject<Group | null>,
  renderer: WebGLRenderer,
  controller: RunnerController,
): void {
  const wheels = useRef<Object3D[]>([]);

  useFrame((_, dt) => {
    if (wheels.current.length === 0) return;
    const state = controller.getState();
    const step = state.speed * dt * wheelSpinRate(state);
    for (const wheel of wheels.current) wheel.rotation.x += step;
  });

  useEffect(() => {
    const url = skateboard01ModelUrl();
    const group = root.current;
    if (!url || !group) return;

    let cancelled = false;
    let model: Object3D | null = null;

    void loadSkateboardModel(url, renderer)
      .then((loaded) => {
        if (cancelled) {
          disposeObject(loaded);
          return;
        }
        fitSkateboard(loaded, SKATEBOARD_01_NOSE_FLIP);
        loaded.name = "Skateboard01";
        const graphic = group.getObjectByName("Graphic");
        if (graphic) placeDeckGraphic(loaded, graphic);
        if (renderer.shadowMap.enabled) {
          loaded.traverse((obj) => {
            if (obj instanceof Mesh) {
              obj.castShadow = true;
              obj.receiveShadow = true;
            }
          });
        }
        group.add(loaded);
        model = loaded;
        const procedural = group.getObjectByName("ProceduralBoard");
        if (procedural) procedural.visible = false;
        wheels.current = collectWheelNodes(loaded);
      })
      .catch((error: unknown) => {
        console.warn("Runner skateboard model failed to load", error);
      });

    return () => {
      cancelled = true;
      wheels.current = [];
      if (model) {
        group.remove(model);
        disposeObject(model);
      }
      const procedural = group.getObjectByName("ProceduralBoard");
      if (procedural) procedural.visible = true;
      const graphic = group.getObjectByName("Graphic");
      if (graphic) resetDeckGraphic(graphic);
    };
  }, [renderer, root, wheels]);
}
