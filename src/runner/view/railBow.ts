import { BoxGeometry, type BufferGeometry, type Object3D, Mesh } from "three";
import { RAIL_BOW, RAIL_LENGTH } from "../tune";
import { railBowOffset } from "../railCurve";

/**
 * Bend a rail so its +Z end (the lip) stays put and the middle shifts +X.
 * The sim uses the same sine, so the trucks stay on the metal.
 */
export function bowRailGeometry(geometry: BufferGeometry, bow: number): void {
  const position = geometry.getAttribute("position");
  if (!position || bow === 0) return;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const span = Math.max(0.001, maxZ - minZ);
  for (let i = 0; i < position.count; i += 1) {
    const z = position.getZ(i);
    const fromLip = (maxZ - z) / span;
    position.setX(i, position.getX(i) + railBowOffset(fromLip, bow));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
}

const geometries = new Set<BufferGeometry>();

/** Bow each mesh once. Shared geometry is not bowed twice. */
export function bowFittedRail(root: Object3D, bow = RAIL_BOW): void {
  const scale = root.scale.x > 0 ? root.scale.x : 1;
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    if (geometries.has(obj.geometry)) return;
    geometries.add(obj.geometry);
    bowRailGeometry(obj.geometry, bow / scale);
  });
}

let beam: BoxGeometry | null = null;

/** Procedural rail, already bowed, shared by every pool slot. */
export function railBeamGeometry(): BoxGeometry {
  if (!beam) {
    beam = new BoxGeometry(0.18, 0.12, RAIL_LENGTH);
    bowRailGeometry(beam, RAIL_BOW);
  }
  return beam;
}
