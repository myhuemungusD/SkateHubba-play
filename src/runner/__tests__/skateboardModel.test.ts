import { describe, expect, it } from "vitest";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { BOARD_TARGET_LENGTH, collectWheelNodes, fitSkateboard } from "../view/skateboardModel";

function board(width: number, height: number, depth: number): Group {
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(width, height, depth), new MeshBasicMaterial()));
  return root;
}

function sizeOf(root: Group): Vector3 {
  root.updateMatrixWorld(true);
  return new Box3().setFromObject(root).getSize(new Vector3());
}

describe("fitSkateboard", () => {
  it("turns a board authored along X onto -Z and keeps it upright", () => {
    const root = board(2, 0.1, 0.4);
    fitSkateboard(root);
    const box = new Box3().setFromObject(root);
    const size = box.getSize(new Vector3());
    expect(size.z).toBeCloseTo(BOARD_TARGET_LENGTH, 2);
    expect(size.y).toBeLessThan(size.x);
    expect(box.min.y).toBeCloseTo(0, 3);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 3);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 3);
    expect(new Vector3(1, 0, 0).applyQuaternion(root.quaternion).z).toBeLessThan(-0.99);
    expect(new Vector3(0, 1, 0).applyQuaternion(root.quaternion).y).toBeGreaterThan(0.99);
  });

  it("keeps an already-long board upright and at the target length", () => {
    const root = board(0.4, 0.1, 2);
    fitSkateboard(root);
    const size = sizeOf(root);
    expect(size.z).toBeCloseTo(BOARD_TARGET_LENGTH, 2);
    expect(size.y).toBeLessThan(size.x);
    expect(new Vector3(0, 1, 0).applyQuaternion(root.quaternion).y).toBeGreaterThan(0.99);
    expect(new Box3().setFromObject(root).min.y).toBeCloseTo(0, 3);
  });

  it("points the positive long axis toward +Z when the nose flag is set", () => {
    const root = board(0.4, 0.1, 2);
    fitSkateboard(root, true);
    expect(new Vector3(0, 0, 1).applyQuaternion(root.quaternion).z).toBeGreaterThan(0.99);
    expect(sizeOf(root).z).toBeCloseTo(BOARD_TARGET_LENGTH, 2);
  });

  it("leaves an empty group alone", () => {
    const root = new Group();
    fitSkateboard(root);
    expect(root.scale.x).toBe(1);
    expect(root.position.y).toBe(0);
  });
});

describe("collectWheelNodes", () => {
  it("keeps named wheels and skips children of a wheel group", () => {
    const root = new Group();
    const left = new Group();
    left.name = "WheelNoseLeft";
    const hub = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial());
    hub.name = "WheelHub";
    left.add(hub);
    const right = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial());
    right.name = "WheelNoseRight";
    const deck = new Mesh(new BoxGeometry(0.2, 0.02, 1), new MeshBasicMaterial());
    deck.name = "Deck";
    root.add(left, right, deck);
    expect(collectWheelNodes(root)).toEqual([left, right]);
  });
});
