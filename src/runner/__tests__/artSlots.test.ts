import { describe, expect, it } from "vitest";
import { customBoardGraphicUrl, customLogoDecalUrl, mikeWhiteBoardUrl } from "../artSlots";

describe("runner art slots", () => {
  it("stays empty until the custom files are in the repo", () => {
    expect(customBoardGraphicUrl()).toBeNull();
    expect(customLogoDecalUrl()).toBeNull();
    expect(mikeWhiteBoardUrl()).toBeNull();
  });
});
