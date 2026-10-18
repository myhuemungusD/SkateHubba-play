import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANVAS_SIZE, MAX_LAYERS, StudioDoc } from "../engine";
import { ctxOf, installFakeCanvas, paintRect } from "./fakeCanvas.test-helpers";

const BRUSH = { color: "#FF0000", size: 10, opacity: 1, hardness: 0.5 };
const at = (c: HTMLCanvasElement, x: number, y: number) =>
  Array.from(ctxOf(c).buf.subarray((y * CANVAS_SIZE + x) * 4, (y * CANVAS_SIZE + x) * 4 + 4));

describe("StudioDoc", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installFakeCanvas();
  });

  it("starts with one layer and manages up to MAX_LAYERS", () => {
    const d = new StudioDoc();
    expect(d.layers).toHaveLength(1);
    for (let i = 1; i < MAX_LAYERS; i++) d.addLayer();
    expect(d.addLayer()).toBeNull();
    expect(d.layers).toHaveLength(MAX_LAYERS);
  });

  it("deletes, reorders, toggles and undoes structure", () => {
    const d = new StudioDoc();
    const first = d.layers[0];
    expect(d.deleteLayer(first.id)).toBe(false);
    const second = d.addLayer()!;
    expect(d.moveLayer(second.id, 1)).toBe(false);
    expect(d.moveLayer("nope", 1)).toBe(false);
    expect(d.moveLayer(second.id, -1)).toBe(true);
    expect(d.layers[0].id).toBe(second.id);
    d.updateLayer(first.id, { visible: false, opacity: 0.5 });
    expect(d.layers.find((l) => l.id === first.id)?.visible).toBe(false);
    d.select("nope");
    d.select(first.id);
    expect(d.active.id).toBe(first.id);
    expect(d.deleteLayer(first.id)).toBe(true);
    expect(d.active.id).toBe(second.id);
    expect(d.deleteLayer("nope")).toBe(false);
    expect(d.undo()).toBe(true);
    expect(d.layers.map((l) => l.id)).toContain(first.id);
    expect(d.redo()).toBe(true);
    expect(d.layers).toHaveLength(1);
  });

  it("paints strokes with symmetry and erases", () => {
    const d = new StudioDoc();
    const c = ctxOf(d.active.canvas);
    d.continueStroke({ x: 1, y: 1 }, BRUSH, false, false); // no stroke yet
    expect(c.calls).not.toContain("arc");
    d.beginStroke({ x: 10, y: 10 }, BRUSH, false, true);
    expect(c.calls.filter((x) => x === "arc")).toHaveLength(2);
    d.continueStroke({ x: 30, y: 10 }, BRUSH, true, false);
    d.endStroke();
    expect(c.calls.filter((x) => x === "arc").length).toBeGreaterThan(2);
    expect(d.canUndo).toBe(true);
    expect(d.canRedo).toBe(false);
  });

  it("fills a template panel into the active layer and undoes it", () => {
    const d = new StudioDoc();
    paintRect(d.template, 0, 100, CANVAS_SIZE, 102, [0, 0, 0, 255]); // horizontal line
    const n = d.fill({ x: 5, y: 5 }, "#00FF00", true);
    expect(n).toBe(100 * CANVAS_SIZE * 2); // both mirrored taps hit the same panel; counted twice
    expect(at(d.active.canvas, 5, 5)).toEqual([0, 255, 0, 255]);
    expect(at(d.active.canvas, 5, 200)).toEqual([0, 0, 0, 0]);
    expect(d.pick({ x: 5, y: 5 })).toBe("#00FF00");
    expect(d.pick({ x: 5, y: 300 })).toBeNull();
    d.undo();
    expect(at(d.active.canvas, 5, 5)).toEqual([0, 0, 0, 0]);
    d.redo();
    expect(at(d.active.canvas, 5, 5)).toEqual([0, 255, 0, 255]);
  });

  it("ignores a pixel undo for a layer that no longer exists", () => {
    const d = new StudioDoc();
    const l2 = d.addLayer()!;
    d.fill({ x: 1, y: 1 }, "#000001", false);
    // remove l2 without history so the pixel entry is orphaned
    d.layers = d.layers.filter((l) => l.id !== l2.id);
    expect(d.undo()).toBe(true);
  });

  it("stamps text/stickers, imports pictures, sets templates and composites", () => {
    const d = new StudioDoc();
    d.stamp({ x: 50, y: 50 }, "🔥", 40, "#FFFFFF", "sans-serif", true);
    expect(ctxOf(d.active.canvas).calls.filter((x) => x === "fillText")).toHaveLength(2);
    const img = document.createElement("canvas");
    img.width = 1024;
    img.height = 512;
    expect(d.importImage(img)).not.toBeNull();
    d.setTemplate(img);
    d.setTemplate(null);
    d.layers[0].visible = false;
    expect(d.composite().width).toBe(CANVAS_SIZE);
    while (d.addLayer());
    expect(d.importImage(img)).toBeNull();
  });

  it("throws when 2D canvas is unsupported", () => {
    vi.restoreAllMocks();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    const d = new StudioDoc();
    expect(() => d.composite()).toThrow("studio_canvas_unsupported");
  });

  it("accepts a custom canvas factory", () => {
    const make = vi.fn(() => document.createElement("canvas"));
    new StudioDoc(make);
    expect(make).toHaveBeenCalled();
  });
});
