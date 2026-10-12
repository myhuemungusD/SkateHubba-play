import { describe, expect, it } from "vitest";
import {
  customBoardGraphicUrl,
  customLogoDecalUrl,
  lowRailModelUrl,
  mikeWhiteBoardUrl,
  skateboard01ModelUrl,
  skateparkModelUrl,
} from "../artSlots";
import { LOW_RAIL_CREDIT, SKATEBOARD_01_CREDIT, SKATEPARK_CREDIT } from "../boardCredit";

describe("runner art slots", () => {
  it("uses the SkateHubba logo and the compressed board and rail", () => {
    expect(customBoardGraphicUrl()).toContain("board-logo");
    expect(customLogoDecalUrl()).toBe(customBoardGraphicUrl());
    expect(skateboard01ModelUrl()).toContain("skateboard-01");
    expect(lowRailModelUrl()).toContain("low-rail");
    expect(skateparkModelUrl()).toContain("skatepark-obstacles");
    expect(mikeWhiteBoardUrl()).toBeNull();
  });

  it("uses the Sketchfab credit lines", () => {
    expect(SKATEBOARD_01_CREDIT).toBe(
      'This work is based on "Skateboard_01" (https://sketchfab.com/3d-models/skateboard-01-bc02544579d34003a703962d7b930e7b) by CrazyScans (https://sketchfab.com/RandomScan) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    );
    expect(LOW_RAIL_CREDIT).toBe(
      'This work is based on "Low Rail | Game Ready | 4K" (https://sketchfab.com/3d-models/low-rail-game-ready-4k-ec7bba14b8984e67ab459c20422171a0) by bralunit (https://sketchfab.com/bral_unit) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    );
    expect(SKATEPARK_CREDIT).toBe(
      'This work is based on "Skatepark Obstacles" (https://sketchfab.com/3d-models/skatepark-obstacles-235d1cab2dfe4d63b46030db8d459699) by rhcreations (https://sketchfab.com/rhcreations) licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/)',
    );
  });
});
