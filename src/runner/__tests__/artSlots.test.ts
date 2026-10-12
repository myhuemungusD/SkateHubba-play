import { describe, expect, it } from "vitest";
import { customBoardGraphicUrl, customLogoDecalUrl, mikeWhiteBoardUrl, skateboard01ModelUrl } from "../artSlots";
import { SKATEBOARD_01_CREDIT } from "../boardCredit";

describe("runner art slots", () => {
  it("stays empty until the custom files are in the repo", () => {
    expect(customBoardGraphicUrl()).toBeNull();
    expect(customLogoDecalUrl()).toBeNull();
    expect(mikeWhiteBoardUrl()).toBeNull();
    expect(skateboard01ModelUrl()).toBeNull();
  });

  it("credits Skateboard_01 by RandomScan", () => {
    expect(SKATEBOARD_01_CREDIT).toBe("Skateboard_01 by RandomScan (Sketchfab), CC BY 4.0");
  });
});
