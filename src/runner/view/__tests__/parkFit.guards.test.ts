import { afterEach, describe, expect, it, vi } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { fitParkPiece } from "../parkFit";

const LEDGE = { length: 3.6, maxWidth: 1.25, maxHeight: 0.48, minWidth: 0.22 };

function sizeOf(root: Group | Mesh): Vector3 {
  root.updateMatrixWorld(true);
  return new Box3().setFromObject(root).getSize(new Vector3());
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fitParkPiece guards", () => {
  it("resets an empty node and leaves it unscaled", () => {
    const empty = new Group();
    empty.position.set(4, 5, 6);
    empty.rotation.set(1, 1, 1);
    empty.scale.setScalar(3);
    fitParkPiece(empty, LEDGE);
    expect(empty.position.toArray()).toEqual([0, 0, 0]);
    expect(empty.rotation.toArray().slice(0, 3)).toEqual([0, 0, 0]);
    expect(empty.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("stops if the piece has no finite size after turning it down the street", () => {
    const mesh = new Mesh(new BoxGeometry(4, 1, 2), new MeshBasicMaterial());
    const real = Box3.prototype.getSize;
    let calls = 0;
    vi.spyOn(Box3.prototype, "getSize").mockImplementation(function (this: Box3, target: Vector3) {
      calls += 1;
      // First measure is real; the measure after the turn comes back empty.
      return calls === 2 ? target.set(Number.NaN, 1, 1) : real.call(this, target);
    });
    fitParkPiece(mesh, LEDGE);
    expect(mesh.rotation.y).toBeCloseTo(Math.PI / 2);
    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
    expect(mesh.position.toArray()).toEqual([0, 0, 0]);
  });

  it("keeps scale 1 when the fit has no usable bound", () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 2), new MeshBasicMaterial());
    fitParkPiece(mesh, { length: 3, maxWidth: 1, maxHeight: 0, minWidth: 0 });
    expect(mesh.scale.toArray()).toEqual([1, 1, 1]);
    // Still grounded and centered.
    const box = new Box3().setFromObject(mesh);
    expect(box.min.y).toBeCloseTo(0);
  });

  it("widens a turned rail along its local Z, which is world X after the turn", () => {
    const rail = new Mesh(new BoxGeometry(10, 1, 0.1), new MeshBasicMaterial());
    fitParkPiece(rail, LEDGE);
    expect(rail.rotation.y).toBeCloseTo(Math.PI / 2);
    const size = sizeOf(rail);
    expect(size.x).toBeCloseTo(0.22, 3);
    expect(size.z).toBeCloseTo(3.6, 2);
    expect(rail.scale.z).toBeGreaterThan(rail.scale.x);
    const box = new Box3().setFromObject(rail);
    expect(box.min.y).toBeCloseTo(0, 4);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 4);
  });

  it("leaves a wide enough piece alone in the widen pass", () => {
    const mesh = new Mesh(new BoxGeometry(1, 0.4, 3.6), new MeshBasicMaterial());
    fitParkPiece(mesh, LEDGE);
    const s = mesh.scale;
    expect(s.x).toBeCloseTo(s.z);
    expect(sizeOf(mesh).x).toBeCloseTo(1, 3);
  });
});
