import { vi } from "vitest";

/**
 * jsdom has no 2D canvas. This fake keeps real pixel buffers per canvas so
 * fill / eyedropper / undo are exercised end to end; drawing calls that
 * would need a rasterizer (arc, gradients, text, drawImage) are recorded.
 * drawImage copies pixels when the source is another fake canvas so
 * composite() reflects layers.
 */
export interface FakeCtx {
  canvas: HTMLCanvasElement;
  buf: Uint8ClampedArray;
  calls: string[];
  [k: string]: unknown;
}

const store = new WeakMap<HTMLCanvasElement, FakeCtx>();

function makeCtx(canvas: HTMLCanvasElement): FakeCtx {
  const w = canvas.width || 300;
  const h = canvas.height || 150;
  const ctx: FakeCtx = {
    canvas,
    buf: new Uint8ClampedArray(w * h * 4),
    calls: [],
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
  };
  const rec =
    (name: string) =>
    (..._a: unknown[]) => {
      ctx.calls.push(name);
    };
  Object.assign(ctx, {
    beginPath: rec("beginPath"),
    arc: rec("arc"),
    fill: rec("fill"),
    fillText: rec("fillText"),
    clearRect: () => {
      ctx.calls.push("clearRect");
      ctx.buf.fill(0);
    },
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
    createImageData: (cw: number, chh: number) => ({
      data: new Uint8ClampedArray(cw * chh * 4),
      width: cw,
      height: chh,
    }),
    getImageData: (x: number, y: number, gw: number, gh: number) => {
      const out = new Uint8ClampedArray(gw * gh * 4);
      for (let row = 0; row < gh; row++) {
        const start = ((y + row) * w + x) * 4;
        out.set(ctx.buf.subarray(start, start + gw * 4), row * gw * 4);
      }
      return { data: out, width: gw, height: gh };
    },
    putImageData: (img: { data: Uint8ClampedArray; width: number }, _x: number, _y: number) => {
      ctx.calls.push("putImageData");
      if (img.width === w) ctx.buf.set(img.data.subarray(0, ctx.buf.length));
    },
    drawImage: (src: unknown) => {
      ctx.calls.push("drawImage");
      const other = src instanceof HTMLCanvasElement ? store.get(src) : undefined;
      if (!other || other.buf.length !== ctx.buf.length) return;
      for (let i = 0; i < ctx.buf.length; i += 4)
        if (other.buf[i + 3] > 0) ctx.buf.set(other.buf.subarray(i, i + 4), i);
    },
  });
  return ctx;
}

export function ctxOf(canvas: HTMLCanvasElement): FakeCtx {
  let ctx = store.get(canvas);
  if (!ctx) {
    ctx = makeCtx(canvas);
    store.set(canvas, ctx);
  }
  return ctx;
}

export function installFakeCanvas(): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
    return ctxOf(this) as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => "data:image/png;base64,AAAA");
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (cb: BlobCallback) {
    const b = new Blob(["x".repeat(500)], { type: "image/webp" });
    cb(b);
  });
}

/** Paint a solid rectangle straight into a canvas's buffer. */
export function paintRect(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rgba: number[],
): void {
  const ctx = ctxOf(canvas);
  const w = canvas.width;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) ctx.buf.set(rgba, (y * w + x) * 4);
}
