import { describe, expect, it } from "vitest";
import { clearedTrickFields, trickFieldsFromSelection, trickSnapshot } from "../trickFields";

describe("trickFields", () => {
  it("returns nulls when the picker was not used", () => {
    expect(clearedTrickFields()).toEqual({
      currentTrickId: null,
      currentTrickStance: null,
      currentTrickObstacle: null,
      currentTrickNameCustom: null,
    });
    expect(trickFieldsFromSelection(null)).toEqual({
      displayName: null,
      fields: clearedTrickFields(),
    });
    expect(trickFieldsFromSelection(undefined)).toEqual({
      displayName: null,
      fields: clearedTrickFields(),
    });
  });

  it("builds a display name and structured fields from a catalog pick", () => {
    expect(
      trickFieldsFromSelection({
        trickId: "kickflip",
        stance: "switch",
        obstacle: "ledge",
        trickNameCustom: "   ",
      }),
    ).toEqual({
      displayName: "Switch Kickflip",
      fields: {
        currentTrickId: "kickflip",
        currentTrickStance: "switch",
        currentTrickObstacle: "ledge",
        currentTrickNameCustom: null,
      },
    });
  });

  it("rejects an unknown id and an empty Other name", () => {
    expect(() =>
      trickFieldsFromSelection({
        trickId: "nope",
        stance: "regular",
        obstacle: null,
        trickNameCustom: null,
      }),
    ).toThrow("Pick a trick from the list");
    expect(() =>
      trickFieldsFromSelection({
        trickId: "other",
        stance: "regular",
        obstacle: null,
        trickNameCustom: "  ",
      }),
    ).toThrow("Pick a trick from the list");
  });

  it("copies a snapshot only when the turn used the catalog", () => {
    expect(trickSnapshot({})).toEqual({});
    expect(trickSnapshot({ currentTrickId: "" })).toEqual({});
    expect(
      trickSnapshot({
        currentTrickId: "ollie",
        currentTrickStance: "fakie",
        currentTrickObstacle: "gap",
        currentTrickNameCustom: null,
      }),
    ).toEqual({
      trickId: "ollie",
      stance: "fakie",
      obstacle: "gap",
      trickNameCustom: null,
    });
    expect(trickSnapshot({ currentTrickId: "ollie" })).toEqual({
      trickId: "ollie",
      stance: "regular",
      obstacle: null,
      trickNameCustom: null,
    });
  });
});
