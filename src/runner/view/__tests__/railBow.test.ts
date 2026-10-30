import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { RAIL_BOW, RAIL_LENGTH } from "../../tune";
import { railBowOffset } from "../../railCurve";
import { bowFittedRail, bowRailGeometry, railBeamGeometry } from "../railBow";

/** Map of z → x for every vertex, so the bend can be read back by position. */
function xAtZ(geometry: BufferGeometry): Map<number, number[]> {
  const position = geometry.getAttribute("position");
  const out = new Map<number, number[]>();
  for (let i = 0; i < position.count; i += 1) {
    const z = Math.round(position.getZ(i) * 1e4) / 1e4;
    const list = out.get(z) ?? [];
    list.push(position.getX(i));
    out.set(z, list);
  }
  return out;
}

describe("bowRailGeometry", () => {
  it("keeps the +Z lip in place and pushes the middle by the sim's sine", () => {
    const geometry = new BoxGeometry(0.2, 0.1, 4, 1, 1, 4);
    const before = xAtZ(geometry);
    bowRailGeometry(geometry, 0.3);
    const after = xAtZ(geometry);

    // Lip (z = +2) and far end (z = -2): zero offset at both ends.
    expect(after.get(2)).toEqual(before.get(2));
    for (const [i, x] of (after.get(-2) ?? []).entries()) expect(x).toBeCloseTo((before.get(-2) ?? [])[i] ?? NaN, 6);
    // Middle (z = 0) is halfway from the lip: full bow.
    for (const [i, x] of (after.get(0) ?? []).entries()) {
      expect(x - ((before.get(0) ?? [])[i] ?? NaN)).toBeCloseTo(railBowOffset(0.5, 0.3), 6);
    }
    // A quarter from the lip (z = 1).
    for (const [i, x] of (after.get(1) ?? []).entries()) {
      expect(x - ((before.get(1) ?? [])[i] ?? NaN)).toBeCloseTo(railBowOffset(0.25, 0.3), 6);
    }
    expect(geometry.getAttribute("normal")).toBeDefined();
  });

  it("does nothing for a zero bow or a geometry with no positions", () => {
    const flat = new BoxGeometry(0.2, 0.1, 4, 1, 1, 4);
    const version = (flat.getAttribute("position") as BufferAttribute).version;
    bowRailGeometry(flat, 0);
    expect((flat.getAttribute("position") as BufferAttribute).version).toBe(version);
    expect(() => bowRailGeometry(new BufferGeometry(), 0.3)).not.toThrow();
  });
});

describe("bowFittedRail", () => {
  it("divides the bow by the root scale so the world bow matches the sim", () => {
    const root = new Group();
    root.scale.setScalar(2);
    const geometry = new BoxGeometry(0.2, 0.1, 4, 1, 1, 2);
    const before = xAtZ(geometry);
    root.add(new Mesh(geometry, new MeshBasicMaterial()));
    bowFittedRail(root, 0.4);
    const mid = xAtZ(geometry).get(0) ?? [];
    expect(mid.length).toBeGreaterThan(0);
    for (const [i, x] of mid.entries()) expect(x - ((before.get(0) ?? [])[i] ?? NaN)).toBeCloseTo(0.2, 6);
  });

  it("treats a zero scale as 1 and bows shared geometry only once", () => {
    const root = new Group();
    root.scale.set(0, 1, 1);
    const geometry = new BoxGeometry(0.2, 0.1, 4, 1, 1, 2);
    const before = xAtZ(geometry);
    root.add(new Mesh(geometry, new MeshBasicMaterial()), new Mesh(geometry, new MeshBasicMaterial()), new Group());
    bowFittedRail(root, 0.4);
    // Second pass over the same geometry is skipped.
    bowFittedRail(root, 0.4);
    for (const [i, x] of (xAtZ(geometry).get(0) ?? []).entries()) {
      expect(x - ((before.get(0) ?? [])[i] ?? NaN)).toBeCloseTo(0.4, 6);
    }
  });

  it("uses RAIL_BOW by default", () => {
    const root = new Group();
    const geometry = new BoxGeometry(0.2, 0.1, 4, 1, 1, 2);
    const before = xAtZ(geometry);
    root.add(new Mesh(geometry, new MeshBasicMaterial()));
    bowFittedRail(root);
    for (const [i, x] of (xAtZ(geometry).get(0) ?? []).entries()) {
      expect(x - ((before.get(0) ?? [])[i] ?? NaN)).toBeCloseTo(RAIL_BOW, 6);
    }
  });
});

describe("railBeamGeometry", () => {
  it("is one shared, already-bowed beam the length of a rail", () => {
    const beam = railBeamGeometry();
    expect(railBeamGeometry()).toBe(beam);
    beam.computeBoundingBox();
    const box = beam.boundingBox;
    expect(box?.max.z).toBeCloseTo(RAIL_LENGTH / 2);
    expect(box?.min.z).toBeCloseTo(-RAIL_LENGTH / 2);
    // A one-segment box has vertices only at the two ends, where the bow is
    // zero, so the beam keeps its width.
    expect(box?.max.x).toBeCloseTo(0.09);
  });
});
