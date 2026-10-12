import { describe, expect, it } from "vitest";
import { BOARD_NODES, boardPose } from "../boardPose";
import { createRun } from "../logic";

describe("board pose", () => {
  it("names the deck parts a later model can match", () => {
    expect(BOARD_NODES).toEqual([
      "Deck",
      "Griptape",
      "Graphic",
      "TruckNose",
      "TruckTail",
      "WheelNoseLeft",
      "WheelNoseRight",
      "WheelTailLeft",
      "WheelTailRight",
    ]);
  });

  it("poses the board from the run, with no skater stance", () => {
    const riding = createRun({ spawn: false });
    expect(boardPose(riding)).toMatchObject({ pitch: 0.03, spin: 0, y: 0 });
    expect(boardPose({ ...riding, duck: 0.1 }).yaw).toBeGreaterThan(0.5);
    expect(boardPose({ ...riding, flip: 0.19 }).spin).toBeCloseTo(0.5);
    expect(boardPose({ ...riding, onGrind: true, grindTrick: "crooked", y: 0.3 })).toMatchObject({
      yaw: 0.62,
      y: 0.3,
    });
    const nose = boardPose({ ...riding, onGrind: true, grindTrick: "nose", y: 0.34 });
    expect(nose.pitch).toBeLessThan(0);
    expect(nose.yaw).toBeCloseTo(Math.PI / 2, 2);
    expect(boardPose({ ...riding, status: "gameover" }).roll).toBeGreaterThan(1);
  });
});
