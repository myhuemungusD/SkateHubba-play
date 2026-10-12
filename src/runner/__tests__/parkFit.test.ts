import { describe, expect, it } from "vitest";
import { Box3, BoxGeometry, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { fitParkPiece } from "../view/parkFit";
import { LEDGE_NODE_NAMES, SCENERY_NODE_NAMES } from "../view/skatepark";

describe("fitParkPiece", () => {
  it("turns the long axis down the street and caps width and height", () => {
    const mesh = new Mesh(new BoxGeometry(8, 1, 4), new MeshBasicMaterial());
    fitParkPiece(mesh, { length: 3.6, maxWidth: 1.25, maxHeight: 0.48, minWidth: 0 });
    const box = new Box3().setFromObject(mesh);
    const size = box.getSize(new Vector3());
    expect(size.z).toBeGreaterThan(size.x);
    expect(size.x).toBeCloseTo(1.25, 2);
    expect(size.y).toBeLessThanOrEqual(0.48 + 1e-6);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 3);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 3);
  });

  it("widens a rail that would otherwise scale to a sliver", () => {
    const mesh = new Mesh(new BoxGeometry(0.1, 1, 10), new MeshBasicMaterial());
    fitParkPiece(mesh, { length: 3.6, maxWidth: 1.25, maxHeight: 0.48, minWidth: 0.22 });
    mesh.updateMatrixWorld(true);
    const box = new Box3().setFromObject(mesh);
    const size = box.getSize(new Vector3());
    expect(size.z).toBeCloseTo(3.6, 2);
    expect(size.x).toBeCloseTo(0.22, 2);
    expect(size.y).toBeLessThanOrEqual(0.48 + 1e-6);
    expect(box.min.y).toBeCloseTo(0, 3);
  });
});

describe("skatepark node split", () => {
  it("keeps grind pieces on the ledge list and banks off the street", () => {
    expect(LEDGE_NODE_NAMES).toContain("Funbox with Coping_14");
    expect(LEDGE_NODE_NAMES).toContain("Table Top with Rail 1_23");
    expect(LEDGE_NODE_NAMES).toContain("Picnic bench_0");
    expect(LEDGE_NODE_NAMES).toContain("Curved Rail 1_63");
    expect(SCENERY_NODE_NAMES.some((name) => name.includes("Bank"))).toBe(true);
    expect(SCENERY_NODE_NAMES.some((name) => name.includes("Quarterpipe"))).toBe(true);
    expect(SCENERY_NODE_NAMES.some((name) => name.includes("Kicker"))).toBe(true);
    const ledges = new Set<string>(LEDGE_NODE_NAMES);
    expect(SCENERY_NODE_NAMES.some((name) => ledges.has(name))).toBe(false);
  });
});
