import { describe, expect, it } from "vitest";
import { hexToRgb, hsvToRgb, isHex, pushRecent, rgbToHex, rgbToHsv, SWATCHES, wheelToHex } from "../color";
import { floodFill } from "../fill";
import { History } from "../history";
import { interpolate, mirror, pinch, toCanvas, withSymmetry, MAX_ZOOM } from "../geometry";
import { BLANK_TEMPLATE, creditForTemplate, STUDIO_TEMPLATES, templateById } from "../templates";
import { MIKE_WHITE_COLLECTION, MIKE_WHITE_TEMPLATE_CREDIT } from "../../closet/mikeWhiteCollection";
import { APP_CREDITS } from "../../appCredits";

describe("color", () => {
  it("round-trips hex/rgb/hsv", () => {
    expect(hexToRgb("#FF6B00")).toEqual({ r: 255, g: 107, b: 0 });
    expect(hexToRgb("nope")).toEqual({ r: 0, g: 0, b: 0 });
    expect(rgbToHex({ r: 300, g: -4, b: 15.6 })).toBe("#FF0010");
    for (const hex of SWATCHES) expect(rgbToHex(hsvToRgb(rgbToHsv(hexToRgb(hex))))).toBe(hex);
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    expect(isHex("#abcdef")).toBe(true);
    expect(isHex(3)).toBe(false);
  });

  it("maps the wheel: center is white, edge is a saturated hue", () => {
    expect(wheelToHex(0, 0, 50, 1)).toBe("#FFFFFF");
    expect(wheelToHex(50, 0, 50, 1)).toBe("#FF0000");
    expect(wheelToHex(500, 0, 50, 1)).toBe("#FF0000");
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("keeps recent colors deduped, newest first, capped", () => {
    expect(pushRecent(["#000000", "#FFFFFF"], "#ffffff")).toEqual(["#FFFFFF", "#000000"]);
    expect(pushRecent(["#1", "#2", "#3"], "#4", 3)).toEqual(["#4", "#1", "#2"]);
  });
});

describe("floodFill", () => {
  const W = 10;
  const px = () => ({ data: new Uint8ClampedArray(W * W * 4), width: W, height: W });

  it("fills the panel under the tap and stops at lines", () => {
    const boundary = px();
    for (let y = 0; y < W; y++) boundary.data.set([0, 0, 0, 255], (y * W + 5) * 4); // vertical line at x=5
    const target = px();
    const n = floodFill(boundary, target, 2, 2, [255, 0, 0, 255]);
    expect(n).toBe(50);
    expect(target.data[(2 * W + 2) * 4]).toBe(255);
    expect(target.data[(2 * W + 7) * 4]).toBe(0);
  });

  it("handles concave regions and rejects bad input", () => {
    const boundary = px();
    // U-shape wall
    for (let y = 2; y < 8; y++) boundary.data.set([0, 0, 0, 255], (y * W + 4) * 4);
    const target = px();
    expect(floodFill(boundary, target, 0, 9, [1, 2, 3, 255])).toBe(94);
    expect(floodFill(boundary, target, -1, 0, [1, 2, 3, 255])).toBe(0);
    expect(floodFill(boundary, target, 0, 10, [1, 2, 3, 255])).toBe(0);
    expect(floodFill(boundary, { ...px(), width: 5 }, 0, 0, [1, 2, 3, 255])).toBe(0);
  });
});

describe("History", () => {
  it("undoes, redoes, caps and clears", () => {
    const h = new History<number>(2);
    expect(h.undo((e) => e)).toBe(false);
    expect(h.redo((e) => e)).toBe(false);
    h.push(1);
    h.push(2);
    h.push(3);
    const seen: number[] = [];
    while (h.undo((e) => (seen.push(e), e * 10)));
    expect(seen).toEqual([3, 2]);
    expect(h.canRedo).toBe(true);
    expect(h.redo((e) => e)).toBe(true);
    expect(h.canUndo).toBe(true);
    h.push(9);
    expect(h.canRedo).toBe(false);
    h.clear();
    expect(h.canUndo).toBe(false);
  });
});

describe("geometry", () => {
  it("interpolates dabs and mirrors", () => {
    expect(interpolate({ x: 0, y: 0 }, { x: 10, y: 0 }, 5)).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
    ]);
    expect(interpolate({ x: 0, y: 0 }, { x: 0, y: 0 }, 0)).toHaveLength(1);
    expect(mirror({ x: 10, y: 3 }, 100)).toEqual({ x: 90, y: 3 });
    expect(withSymmetry([{ x: 1, y: 1 }], 10, false)).toHaveLength(1);
    expect(withSymmetry([{ x: 1, y: 1 }], 10, true)).toEqual([
      { x: 1, y: 1 },
      { x: 9, y: 1 },
    ]);
    expect(toCanvas(150, 100, { left: 100, top: 50, width: 100, height: 100 }, 512)).toEqual({ x: 256, y: 256 });
  });

  it("pinches between zoom limits and resets pan at 1x", () => {
    const v = { zoom: 1, panX: 0, panY: 0 };
    const zoomed = pinch(v, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: 20, y: 5 });
    expect(zoomed.zoom).toBe(2);
    expect(zoomed.panY).toBe(5);
    expect(pinch(zoomed, { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toEqual(v);
    expect(pinch(v, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 }).zoom).toBe(MAX_ZOOM);
  });
});

describe("templates + credits", () => {
  it("offers every Mike White design as a credited template", () => {
    expect(STUDIO_TEMPLATES).toHaveLength(MIKE_WHITE_COLLECTION.length);
    expect(STUDIO_TEMPLATES.every((t) => t.designer?.designer === "Mike White")).toBe(true);
    expect(creditForTemplate(STUDIO_TEMPLATES[0].id)).toBe(MIKE_WHITE_TEMPLATE_CREDIT);
    expect(creditForTemplate("")).toBe("");
    expect(templateById(STUDIO_TEMPLATES[1].id)).toBe(STUDIO_TEMPLATES[1]);
    expect(templateById("missing")).toBe(BLANK_TEMPLATE);
  });

  it("lists Mike White in the app credits", () => {
    expect(APP_CREDITS[0].who).toBe("Mike White");
    expect(APP_CREDITS[0].what).toContain("Based on a Mike White design");
  });
});
