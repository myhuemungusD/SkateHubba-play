import { describe, expect, it } from "vitest";
import { createRun } from "../logic";
import { SKATER_CLIPS, clipForPose, poseFromState } from "../skaterRig";

describe("skater rig contract", () => {
  it("keeps the clip names the glTF file must use", () => {
    expect(SKATER_CLIPS).toEqual({
      idle: "Idle",
      push: "Push",
      ollie: "Ollie",
      powerslide: "Powerslide",
      boardslide: "Boardslide",
      bail: "Bail",
    });
    expect(clipForPose("ride")).toBe("Push");
    expect(clipForPose("ollie")).toBe("Ollie");
    expect(clipForPose("duck")).toBe("Powerslide");
    expect(clipForPose("boardslide")).toBe("Boardslide");
    expect(clipForPose("bail")).toBe("Bail");
  });

  it("picks a pose from the run", () => {
    const riding = createRun({ spawn: false });
    expect(poseFromState(riding)).toBe("ride");
    expect(poseFromState({ ...riding, ollie: 0.1 })).toBe("ollie");
    expect(poseFromState({ ...riding, duck: 0.1 })).toBe("duck");
    expect(poseFromState({ ...riding, onRail: true })).toBe("boardslide");
    expect(poseFromState({ ...riding, status: "gameover" })).toBe("bail");
  });
});
