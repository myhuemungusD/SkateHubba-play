import { describe, expect, it, vi } from "vitest";

// A multi-view skin that names its views but no `needs` list: the loader must
// still hand the viewer an array so it can check what to fetch.
vi.mock("../shoe360Skins.json", () => ({
  default: {
    test_views_only: { aspect: 0.4, top: [0.5], bottom: [0], views: ["outer", "top"] },
  },
}));

describe("shoeSkinFor with a views-only entry", () => {
  it("defaults needs to an empty list", async () => {
    const { shoeSkinFor } = await import("../shoe360");
    const skin = shoeSkinFor("test_views_only");
    expect(skin?.views).toEqual(["outer", "top"]);
    expect(skin?.needs).toEqual([]);
    expect(skin?.profile).toEqual({ aspect: 0.4, top: [0.5], bottom: [0] });
  });
});
