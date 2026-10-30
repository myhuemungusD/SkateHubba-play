import { describe, expect, it } from "vitest";
import { BoxGeometry, BufferGeometry, Group, Mesh, MeshBasicMaterial } from "three";
import { RAIL_BOW } from "../../tune";
import { railBowOffset } from "../../railCurve";
import { bowFittedRail } from "../railBow";

// The cases that src/runner/__tests__/railBow.test.ts (#920) does not cover:
// the +Z lip staying put at every station, and the RAIL_BOW default.

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

/** Bow one mesh under a fresh root, and return the x shift at each station. */
function shiftAt(bow?: number): (z: number) => number[] {
  const geometry = new BoxGeometry(0.2, 0.1, 4, 1, 1, 4);
  const before = xAtZ(geometry);
  const root = new Group();
  root.add(new Mesh(geometry, new MeshBasicMaterial()));
  bowFittedRail(root, bow);
  const after = xAtZ(geometry);
  return (z) => (after.get(z) ?? []).map((x, i) => x - ((before.get(z) ?? [])[i] ?? NaN));
}

describe("bowFittedRail", () => {
  it("keeps the +Z lip in place and pushes each station by the sim's sine", () => {
    const shift = shiftAt(0.3);
    // Lip (z = +2) and far end (z = -2): zero offset at both ends.
    expect(shift(2).length).toBeGreaterThan(0);
    for (const dx of shift(2)) expect(dx).toBe(0);
    for (const dx of shift(-2)) expect(dx).toBeCloseTo(0, 6);
    // A quarter from the lip (z = 1), and the middle (z = 0).
    expect(shift(1).length).toBeGreaterThan(0);
    for (const dx of shift(1)) expect(dx).toBeCloseTo(railBowOffset(0.25, 0.3), 6);
    for (const dx of shift(0)) expect(dx).toBeCloseTo(railBowOffset(0.5, 0.3), 6);
  });

  it("uses RAIL_BOW by default", () => {
    const shift = shiftAt();
    expect(shift(0).length).toBeGreaterThan(0);
    for (const dx of shift(0)) expect(dx).toBeCloseTo(RAIL_BOW, 6);
  });
});
