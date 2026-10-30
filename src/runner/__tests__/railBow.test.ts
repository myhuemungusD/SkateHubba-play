import { BoxGeometry, BufferGeometry, Group, Mesh } from "three";
import { describe, expect, it } from "vitest";
import { railBowOffset } from "../railCurve";
import { RAIL_BOW, RAIL_LENGTH } from "../tune";
import { bowFittedRail, railBeamGeometry } from "../view/railBow";

/** Every vertex as [x, z], so the bend can be read back. */
function xz(geometry: BufferGeometry): Array<[number, number]> {
  const position = geometry.getAttribute("position");
  const out: Array<[number, number]> = [];
  for (let i = 0; i < position.count; i += 1) out.push([position.getX(i), position.getZ(i)]);
  return out;
}

describe("rail bow geometry", () => {
  it("bends the procedural beam with the same sine the sim uses", () => {
    const flat = xz(new BoxGeometry(0.18, 0.12, RAIL_LENGTH));
    const beam = railBeamGeometry();
    expect(beam.parameters.depth).toBe(RAIL_LENGTH);
    const half = RAIL_LENGTH / 2;
    for (const [i, [x, z]] of xz(beam).entries()) {
      const fromLip = (half - z) / RAIL_LENGTH;
      expect(x).toBeCloseTo(flat[i][0] + railBowOffset(fromLip, RAIL_BOW), 6);
    }
  });

  it("shares one cached beam across every pool slot", () => {
    expect(railBeamGeometry()).toBe(railBeamGeometry());
  });

  it("shifts the middle of a fitted rail by the bow divided by the root scale", () => {
    const geometry = new BoxGeometry(0.2, 0.2, 2, 1, 1, 2);
    const root = new Group();
    root.scale.setScalar(2);
    root.add(new Mesh(geometry));
    const before = xz(geometry);
    bowFittedRail(root, 0.4);
    const after = xz(geometry);
    for (const [i, [x, z]] of after.entries()) {
      const shift = x - before[i][0];
      if (Math.abs(z) < 1e-9) expect(shift).toBeCloseTo(0.2, 6);
      else expect(shift).toBeCloseTo(0, 6);
    }
  });

  it("bows shared geometry once, even when two meshes reuse it", () => {
    const geometry = new BoxGeometry(0.2, 0.2, 2, 1, 1, 2);
    const root = new Group();
    root.add(new Mesh(geometry), new Mesh(geometry));
    const before = xz(geometry);
    bowFittedRail(root, 0.3);
    bowFittedRail(root, 0.3);
    const middle = xz(geometry).findIndex(([, z]) => Math.abs(z) < 1e-9);
    expect(xz(geometry)[middle][0] - before[middle][0]).toBeCloseTo(0.3, 6);
  });

  it("treats a zero root scale as unscaled", () => {
    const geometry = new BoxGeometry(0.2, 0.2, 2, 1, 1, 2);
    const root = new Group();
    root.scale.setScalar(0);
    root.add(new Mesh(geometry));
    const before = xz(geometry);
    bowFittedRail(root, 0.25);
    const middle = before.findIndex(([, z]) => Math.abs(z) < 1e-9);
    expect(xz(geometry)[middle][0] - before[middle][0]).toBeCloseTo(0.25, 6);
  });

  it("leaves geometry alone when there is no bow or no position data", () => {
    const geometry = new BoxGeometry(0.2, 0.2, 2, 1, 1, 2);
    const before = xz(geometry);
    const root = new Group();
    root.add(new Mesh(geometry), new Mesh(new BufferGeometry()));
    bowFittedRail(root, 0);
    expect(xz(geometry)).toEqual(before);
  });
});
