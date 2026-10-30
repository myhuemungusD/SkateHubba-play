import { afterEach, describe, expect, it, vi } from "vitest";
import { bindRunnerTouch, createGestureRecognizer, gradeFlick, type TimedPoint } from "../gestures";
import { emptyShake, stepPerfectShake } from "../juice";
import { currentRunnerQuality, runnerDpr, runnerUsesBloom } from "../quality";
import { curveSample, grindDirectionOk, railAlong } from "../railCurve";
import { feelPresetById, LANE_X, RAIL_Y } from "../tune";
import { canUseWebGL, noteFps } from "../webgl";

function touch(type: string, points: Array<{ clientX: number; clientY: number }>, timeStamp?: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "changedTouches", { value: points });
  if (timeStamp !== undefined) Object.defineProperty(event, "timeStamp", { value: timeStamp });
  return event;
}

function pointer(type: string, pointerType: string, extra: Record<string, unknown> = {}): Event {
  const event = new Event(type);
  Object.assign(event, { pointerType, clientX: 100, clientY: 100, ...extra });
  return event;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("gradeFlick", () => {
  const stroke = (dx: number, dy: number, ms: number): TimedPoint[] => [
    { x: 0, y: 0, t: 0 },
    { x: dx, y: dy, t: ms },
  ];

  it("gives a full grade when there is no stroke to judge", () => {
    expect(gradeFlick([])).toEqual({ accuracy: 5, speed: 5 });
    const holes = new Array<TimedPoint>(2);
    expect(gradeFlick(holes)).toEqual({ accuracy: 5, speed: 5 });
  });

  it("steps speed down through each tier", () => {
    expect(gradeFlick(stroke(0, 90, 100)).speed).toBe(4);
    expect(gradeFlick(stroke(0, 50, 100)).speed).toBe(3);
    expect(gradeFlick(stroke(0, 20, 100)).speed).toBe(2);
    expect(gradeFlick(stroke(0, 5, 100)).speed).toBe(1);
  });

  it("steps accuracy down as the stroke leans off its axis, and treats no travel as straight", () => {
    expect(gradeFlick(stroke(88, 12, 100)).accuracy).toBe(4);
    expect(gradeFlick(stroke(70, 30, 100)).accuracy).toBe(2);
    expect(gradeFlick(stroke(78, 22, 100)).accuracy).toBe(3);
    expect(gradeFlick(stroke(50, 50, 100)).accuracy).toBe(1);
    expect(gradeFlick(stroke(0, 0, 100)).accuracy).toBe(5);
  });
});

describe("gesture recognizer guards", () => {
  it("ignores samples it does not own and has no lean before a swipe or on a vertical hold", () => {
    const recognize = createGestureRecognizer();
    recognize.sample({ x: 1, y: 1 }, 5);
    expect(recognize.down({ x: 2, y: 100 }, 400)).toBe(false);
    recognize.sample({ x: 3, y: 100 }, 5);

    recognize.down({ x: 200, y: 200 }, 400);
    recognize.sample({ x: 201, y: 200 }, 4);
    expect(recognize.lean({ x: 240, y: 200 })).toBe(0);
    expect(recognize.move({ x: 260, y: 200 }, 40)).toBe("right");
    expect(recognize.lean({ x: 210, y: 300 })).toBe(0);
  });
});

describe("bindRunnerTouch edges", () => {
  it("skips touch events with no touches and works without a lean handler", () => {
    const el = document.createElement("div");
    const onAction = vi.fn();
    const stop = bindRunnerTouch(el, createGestureRecognizer(), onAction);
    el.dispatchEvent(touch("touchstart", []));
    el.dispatchEvent(touch("touchmove", []));
    el.dispatchEvent(touch("touchstart", [{ clientX: 200, clientY: 200 }]));
    el.dispatchEvent(touch("touchmove", [{ clientX: 200, clientY: 120 }], Number.NaN));
    el.dispatchEvent(touch("touchend", []));
    expect(onAction).toHaveBeenCalledWith("flip", expect.any(Object));
    stop();
  });

  it("releases the lean when the finger lifts", () => {
    const el = document.createElement("div");
    const onLean = vi.fn();
    const stop = bindRunnerTouch(el, createGestureRecognizer(), vi.fn(), onLean);
    el.dispatchEvent(touch("touchstart", [{ clientX: 200, clientY: 200 }]));
    el.dispatchEvent(touch("touchmove", [{ clientX: 260, clientY: 200 }]));
    el.dispatchEvent(touch("touchend", []));
    expect(onLean).toHaveBeenLastCalledWith(0);
    stop();
  });

  it("feeds coalesced pen and touch samples, and ignores the mouse", () => {
    const recognize = createGestureRecognizer();
    const sample = vi.spyOn(recognize, "sample");
    const el = document.createElement("div");
    const stop = bindRunnerTouch(el, recognize, vi.fn());
    el.dispatchEvent(pointer("pointerdown", "mouse"));
    expect(sample).not.toHaveBeenCalled();
    el.dispatchEvent(pointer("pointermove", "touch"));
    expect(sample).toHaveBeenCalledTimes(1);
    const coalesced = [
      { clientX: 1, clientY: 2, timeStamp: 3 },
      { clientX: 4, clientY: 5, timeStamp: 6 },
    ];
    el.dispatchEvent(pointer("pointermove", "pen", { getCoalescedEvents: () => coalesced }));
    expect(sample).toHaveBeenLastCalledWith({ x: 4, y: 5 }, 6);
    expect(sample).toHaveBeenCalledTimes(3);
    stop();
  });
});

describe("exhaustive guards", () => {
  it("hand an unknown tier or preset id straight back", () => {
    expect(runnerDpr("ultra" as never)).toBe("ultra");
    expect(runnerUsesBloom("ultra" as never)).toBe("ultra");
    expect(feelPresetById("moon" as never)).toBe("moon");
  });
});

describe("currentRunnerQuality", () => {
  it("reads memory and cores from the navigator when present", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 16 });
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(16);
    expect(currentRunnerQuality()).toBe("high");
    Object.defineProperty(navigator, "deviceMemory", { configurable: true, value: 2 });
    expect(currentRunnerQuality()).toBe("low");
    Reflect.deleteProperty(navigator, "deviceMemory");
  });

  it("treats missing hardware hints as unknown", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (X11; Linux x86_64)");
    vi.spyOn(navigator, "hardwareConcurrency", "get").mockReturnValue(undefined as never);
    expect(currentRunnerQuality()).toBe("high");
  });
});

describe("perfect shake phase", () => {
  it("flips direction on each new perfect lock", () => {
    const clock = emptyShake();
    const lock = { onGrind: true, wasOnGrind: false, grade: "perfect" as const, reducedMotion: false };
    const first = stepPerfectShake(clock, lock, 0.001);
    const second = stepPerfectShake(clock, lock, 0.001);
    expect(Math.sign(first.x)).toBe(-Math.sign(second.x));
  });
});

describe("rail curve degenerate shapes", () => {
  it("treats a zero-length rail as a straight point at its lip", () => {
    expect(railAlong(3, 0)).toBe(0);
    const sample = curveSample({ id: 1, kind: "rail", lane: 1, z: 0, length: 0, awarded: false, resolved: false }, 2);
    expect(sample).toEqual({ x: LANE_X[1], y: RAIL_Y, tx: 0, tz: 1 });
  });

  it("lets a board with no velocity lock", () => {
    expect(grindDirectionOk(0, 0, 1, 0)).toBe(true);
  });
});

describe("webgl edges", () => {
  it("reports no WebGL when creating a context throws", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(canUseWebGL()).toBe(false);
  });

  it("counts frames without an element to write to", () => {
    const bucket = { frames: 0, stamp: 0 };
    noteFps(null, bucket, 1000);
    noteFps(null, bucket, 1600);
    expect(bucket).toEqual({ frames: 0, stamp: 1600 });
  });
});
