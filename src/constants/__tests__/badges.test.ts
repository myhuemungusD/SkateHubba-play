import { describe, expect, it } from "vitest";
import { getBadgeMeta } from "../badges";

describe("getBadgeMeta", () => {
  it("knows launch badges, legendary-spot badges, and skips unknown ids", () => {
    expect(getBadgeMeta("og")?.label).toBe("OG");
    expect(getBadgeMeta("legend_el_toro")?.label).toBe("Legend");
    expect(getBadgeMeta("legend_Bad Id")).toBeUndefined();
    expect(getBadgeMeta("nope")).toBeUndefined();
  });
});
