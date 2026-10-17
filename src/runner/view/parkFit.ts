import { Box3, Object3D, Vector3 } from "three";

export interface ParkFit {
  /** Longest horizontal axis, along the street after the fit. */
  length: number;
  maxWidth: number;
  maxHeight: number;
  /** 0 leaves a thin piece thin. A positive value widens rails that would vanish. */
  minWidth: number;
}

function finiteSize(size: Vector3): boolean {
  return [size.x, size.y, size.z].every((value) => Number.isFinite(value) && value > 0);
}

function measure(root: Object3D): { box: Box3; size: Vector3 } {
  root.updateMatrixWorld(true);
  const box = new Box3().setFromObject(root);
  return { box, size: box.getSize(new Vector3()) };
}

/**
 * Keep the piece upright (these nodes are already Y-up), run the long axis
 * down the street, and uniform-scale it inside the lane. A second pass can
 * widen a rail that scaled down to a sliver.
 */
export function fitParkPiece(root: Object3D, fit: ParkFit): void {
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  root.scale.set(1, 1, 1);

  const first = measure(root);
  if (!finiteSize(first.size)) return;
  if (first.size.x > first.size.z) root.rotation.y = Math.PI / 2;

  const laid = measure(root);
  if (!finiteSize(laid.size)) return;
  const scale = Math.min(fit.length / laid.size.z, fit.maxWidth / laid.size.x, fit.maxHeight / laid.size.y);
  root.scale.setScalar(Number.isFinite(scale) && scale > 0 ? scale : 1);

  const grounded = measure(root);
  const center = grounded.box.getCenter(new Vector3());
  root.position.set(-center.x, -grounded.box.min.y, -center.z);

  const width = measure(root).size.x;
  if (fit.minWidth > 0 && width > 0 && width < fit.minWidth) {
    const factor = fit.minWidth / width;
    if (Math.abs(root.rotation.y) > 0.1) root.scale.z *= factor;
    else root.scale.x *= factor;
    const fixed = measure(root);
    const fixedCenter = fixed.box.getCenter(new Vector3());
    root.position.x -= fixedCenter.x;
    root.position.y -= fixed.box.min.y;
    root.position.z -= fixedCenter.z;
  }
}
