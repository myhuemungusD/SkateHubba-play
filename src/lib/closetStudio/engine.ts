import { hexToRgb } from "./color";
import { floodFill } from "./fill";
import { History } from "./history";
import { interpolate, withSymmetry, type Pt } from "./geometry";

/**
 * Closet Studio document: a fixed-size square canvas made of up to
 * MAX_LAYERS paint layers over an optional locked template. Pixel edits
 * record the layer's previous ImageData; structural edits (add, delete,
 * reorder, visibility, opacity) record the previous layer list. Layer
 * canvases are never destroyed while referenced, so undoing a delete just
 * puts the same canvas back.
 */

export const CANVAS_SIZE = 512;
export const MAX_LAYERS = 8;

export interface Layer {
  id: string;
  name: string;
  canvas: HTMLCanvasElement;
  visible: boolean;
  opacity: number;
}

export interface BrushSettings {
  color: string;
  size: number;
  opacity: number;
  hardness: number;
}

type Entry = { kind: "pixels"; layerId: string; data: ImageData } | { kind: "layers"; layers: Layer[]; active: string };

export type CanvasFactory = () => HTMLCanvasElement;

const defaultFactory: CanvasFactory = () => document.createElement("canvas");

function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("studio_canvas_unsupported");
  return ctx;
}

export class StudioDoc {
  layers: Layer[] = [];
  activeId = "";
  template: HTMLCanvasElement;
  private seq = 0;
  private history = new History<Entry>(40);
  private strokeLast: Pt | null = null;

  constructor(private readonly make: CanvasFactory = defaultFactory) {
    this.template = this.blank();
    this.addLayer(false);
  }

  private blank(): HTMLCanvasElement {
    const c = this.make();
    c.width = CANVAS_SIZE;
    c.height = CANVAS_SIZE;
    return c;
  }

  get active(): Layer {
    return this.layers.find((l) => l.id === this.activeId) ?? this.layers[this.layers.length - 1];
  }
  get canUndo(): boolean {
    return this.history.canUndo;
  }
  get canRedo(): boolean {
    return this.history.canRedo;
  }

  private snapshotLayers(): Entry {
    return { kind: "layers", layers: this.layers.map((l) => ({ ...l })), active: this.activeId };
  }

  private recordPixels(layer: Layer): void {
    const data = ctx2d(layer.canvas).getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    this.history.push({ kind: "pixels", layerId: layer.id, data });
  }

  private apply = (e: Entry): Entry => {
    if (e.kind === "layers") {
      const redo = this.snapshotLayers();
      this.layers = e.layers.map((l) => ({ ...l }));
      this.activeId = e.active;
      return redo;
    }
    const layer = this.layers.find((l) => l.id === e.layerId);
    if (!layer) return e;
    const c = ctx2d(layer.canvas);
    const redo: Entry = { kind: "pixels", layerId: e.layerId, data: c.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE) };
    c.putImageData(e.data, 0, 0);
    return redo;
  };

  undo(): boolean {
    return this.history.undo(this.apply);
  }
  redo(): boolean {
    return this.history.redo(this.apply);
  }

  // ── Layers ──
  addLayer(record = true): Layer | null {
    if (this.layers.length >= MAX_LAYERS) return null;
    if (record) this.history.push(this.snapshotLayers());
    this.seq += 1;
    const layer: Layer = {
      id: `l${this.seq}`,
      name: `Layer ${this.seq}`,
      canvas: this.blank(),
      visible: true,
      opacity: 1,
    };
    this.layers = [...this.layers, layer];
    this.activeId = layer.id;
    return layer;
  }

  deleteLayer(id: string): boolean {
    if (this.layers.length <= 1 || !this.layers.some((l) => l.id === id)) return false;
    this.history.push(this.snapshotLayers());
    this.layers = this.layers.filter((l) => l.id !== id);
    if (this.activeId === id) this.activeId = this.layers[this.layers.length - 1].id;
    return true;
  }

  moveLayer(id: string, dir: -1 | 1): boolean {
    const i = this.layers.findIndex((l) => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= this.layers.length) return false;
    this.history.push(this.snapshotLayers());
    const next = [...this.layers];
    [next[i], next[j]] = [next[j], next[i]];
    this.layers = next;
    return true;
  }

  updateLayer(id: string, patch: Partial<Pick<Layer, "visible" | "opacity" | "name">>): void {
    this.history.push(this.snapshotLayers());
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
  }

  select(id: string): void {
    if (this.layers.some((l) => l.id === id)) this.activeId = id;
  }

  // ── Template ──
  setTemplate(img: CanvasImageSource | null): void {
    const c = ctx2d(this.template);
    c.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    if (img) c.drawImage(img, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  // ── Painting ──
  private dab(c: CanvasRenderingContext2D, p: Pt, b: BrushSettings, erase: boolean): void {
    const r = Math.max(0.5, b.size / 2);
    const { r: cr, g, b: cb } = hexToRgb(b.color);
    const g2 = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    const solid = `rgba(${cr},${g},${cb},${b.opacity})`;
    g2.addColorStop(0, solid);
    g2.addColorStop(Math.min(0.999, Math.max(0, b.hardness)), solid);
    g2.addColorStop(1, `rgba(${cr},${g},${cb},0)`);
    c.globalCompositeOperation = erase ? "destination-out" : "source-over";
    c.fillStyle = g2;
    c.beginPath();
    c.arc(p.x, p.y, r, 0, Math.PI * 2);
    c.fill();
    c.globalCompositeOperation = "source-over";
  }

  beginStroke(p: Pt, b: BrushSettings, erase: boolean, symmetry: boolean): void {
    const layer = this.active;
    this.recordPixels(layer);
    this.strokeLast = p;
    const c = ctx2d(layer.canvas);
    for (const q of withSymmetry([p], CANVAS_SIZE, symmetry)) this.dab(c, q, b, erase);
  }

  continueStroke(p: Pt, b: BrushSettings, erase: boolean, symmetry: boolean): void {
    if (!this.strokeLast) return;
    const c = ctx2d(this.active.canvas);
    const pts = withSymmetry(interpolate(this.strokeLast, p, Math.max(1, b.size * 0.15)), CANVAS_SIZE, symmetry);
    for (const q of pts) this.dab(c, q, b, erase);
    this.strokeLast = p;
  }

  endStroke(): void {
    this.strokeLast = null;
  }

  /** Fill the region under p (found on template + all visible paint) into the active layer. */
  fill(p: Pt, color: string, symmetry: boolean): number {
    const boundary = ctx2d(this.composite()).getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const layer = this.active;
    this.recordPixels(layer);
    const c = ctx2d(layer.canvas);
    const target = c.getImageData(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    const { r, g, b } = hexToRgb(color);
    let n = 0;
    for (const q of withSymmetry([p], CANVAS_SIZE, symmetry))
      n += floodFill(boundary, target, q.x, q.y, [r, g, b, 255]);
    c.putImageData(target, 0, 0);
    return n;
  }

  /** Color under p on the flattened design, as #RRGGBB (null on transparent). */
  pick(p: Pt): string | null {
    const d = ctx2d(this.composite()).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
    if (d[3] === 0) return null;
    return `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
  }

  stamp(p: Pt, text: string, size: number, color: string, font: string, symmetry: boolean): void {
    const layer = this.active;
    this.recordPixels(layer);
    const c = ctx2d(layer.canvas);
    c.font = `${size}px "${font}"`;
    c.fillStyle = color;
    c.textAlign = "center";
    c.textBaseline = "middle";
    for (const q of withSymmetry([p], CANVAS_SIZE, symmetry)) c.fillText(text, q.x, q.y);
  }

  /** Imported picture lands on a new layer, scaled to fit. */
  importImage(img: CanvasImageSource & { width: number; height: number }): Layer | null {
    const layer = this.addLayer();
    if (!layer) return null;
    const s = Math.min(CANVAS_SIZE / img.width, CANVAS_SIZE / img.height, 1);
    const w = img.width * s;
    const h = img.height * s;
    ctx2d(layer.canvas).drawImage(img, (CANVAS_SIZE - w) / 2, (CANVAS_SIZE - h) / 2, w, h);
    return layer;
  }

  /** Flatten template + visible layers into a new canvas. */
  composite(): HTMLCanvasElement {
    const out = this.blank();
    const c = ctx2d(out);
    c.drawImage(this.template, 0, 0);
    for (const l of this.layers) {
      if (!l.visible) continue;
      c.globalAlpha = l.opacity;
      c.drawImage(l.canvas, 0, 0);
    }
    c.globalAlpha = 1;
    return out;
  }
}
