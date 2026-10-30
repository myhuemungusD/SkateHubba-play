import { vi } from "vitest";

/**
 * A stand-in for ../../artSlots whose URLs each test sets. Use it with
 *   vi.mock("../../artSlots", async () => (await import("./art-slots-test-helpers")).artSlotsModule);
 * and call resetSlots() in beforeEach. Every slot starts null, so nothing
 * fetches unless a test opts in.
 */
export const slots = {
  graphic: null as string | null,
  logo: null as string | null,
  mikeWhite: null as string | null,
  skateboard: null as string | null,
  lowRail: null as string | null,
  skatepark: null as string | null,
};

export function resetSlots(): void {
  slots.graphic = null;
  slots.logo = null;
  slots.mikeWhite = null;
  slots.skateboard = null;
  slots.lowRail = null;
  slots.skatepark = null;
}

export const artSlotsModule = {
  SKATEBOARD_01_NOSE_FLIP: false,
  customBoardGraphicUrl: () => slots.graphic,
  customLogoDecalUrl: () => slots.logo,
  mikeWhiteBoardUrl: () => slots.mikeWhite,
  skateboard01ModelUrl: () => slots.skateboard,
  lowRailModelUrl: () => slots.lowRail,
  skateparkModelUrl: () => slots.skatepark,
};

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued promise callbacks run. */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

export interface FakeContext2D {
  font: string;
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  textAlign: string;
  textBaseline: string;
  fillRect: ReturnType<typeof vi.fn>;
  fillText: ReturnType<typeof vi.fn>;
  measureText: (text: string) => { width: number };
  beginPath: ReturnType<typeof vi.fn>;
  moveTo: ReturnType<typeof vi.fn>;
  bezierCurveTo: ReturnType<typeof vi.fn>;
  stroke: ReturnType<typeof vi.fn>;
  /** Font size in px at every fillText call, in order. */
  fontsAtFill: number[];
}

/**
 * jsdom has no 2D canvas. This one records draws and measures text as
 * 0.6 × font size per character, so long lines overflow like a real font.
 */
export function fakeContext2D(): FakeContext2D {
  const ctx: FakeContext2D = {
    font: "10px sans-serif",
    fillStyle: "#000",
    strokeStyle: "#000",
    lineWidth: 1,
    textAlign: "start",
    textBaseline: "alphabetic",
    fillRect: vi.fn(),
    fillText: vi.fn(() => {
      ctx.fontsAtFill.push(Number.parseFloat(ctx.font));
    }),
    measureText: (text: string) => ({ width: Number.parseFloat(ctx.font) * 0.6 * text.length }),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    stroke: vi.fn(),
    fontsAtFill: [],
  };
  return ctx;
}

/** Make every canvas hand out `ctx` (or null, like jsdom without the canvas package). */
export function stubCanvas2D(ctx: FakeContext2D | null): void {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    (() => ctx) as unknown as HTMLCanvasElement["getContext"],
  );
}
