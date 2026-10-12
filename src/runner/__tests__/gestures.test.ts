import { describe, expect, it } from "vitest";
import { bindRunnerTouch, createGestureRecognizer, EDGE_DEAD_ZONE_PX } from "../gestures";

function touchEvent(type: string, x: number, y: number): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "changedTouches", {
    value: [{ clientX: x, clientY: y, identifier: 1 }],
  });
  return event;
}

describe("swipe recognition", () => {
  it("commits on the way, one action per gesture, and treats up as an ollie", () => {
    const gesture = createGestureRecognizer();
    expect(gesture.down({ x: 200, y: 200 }, 400)).toBe(true);
    expect(gesture.ownsGesture()).toBe(true);
    expect(gesture.move({ x: 210, y: 190 })).toBeNull();
    expect(gesture.move({ x: 200, y: 150 })).toBe("ollie");
    expect(gesture.move({ x: 40, y: 40 })).toBeNull();
    gesture.up();
    expect(gesture.move({ x: 10, y: 10 })).toBeNull();
  });

  it("maps the other three directions by the dominant axis", () => {
    const right = createGestureRecognizer();
    right.down({ x: 100, y: 100 }, 400);
    expect(right.move({ x: 160, y: 110 })).toBe("right");

    const left = createGestureRecognizer();
    left.down({ x: 100, y: 100 }, 400);
    expect(left.move({ x: 40, y: 110 })).toBe("left");

    const duck = createGestureRecognizer();
    duck.down({ x: 100, y: 100 }, 400);
    expect(duck.move({ x: 110, y: 160 })).toBe("duck");
  });

  it("leaves both screen edges for the browser back gesture", () => {
    const gesture = createGestureRecognizer();
    expect(gesture.down({ x: EDGE_DEAD_ZONE_PX - 4, y: 80 }, 400)).toBe(false);
    expect(gesture.ownsGesture()).toBe(false);
    expect(gesture.move({ x: 200, y: 80 })).toBeNull();

    expect(gesture.down({ x: 400 - 4, y: 80 }, 400)).toBe(false);
    expect(gesture.move({ x: 200, y: 20 })).toBeNull();
  });

  it("cancels page scroll only for a gesture the game owns", () => {
    const actions: string[] = [];
    const el = document.createElement("div");
    const stop = bindRunnerTouch(el, createGestureRecognizer(), (action) => {
      actions.push(action);
    });

    const owned = touchEvent("touchmove", 200, 120);
    el.dispatchEvent(touchEvent("touchstart", 200, 200));
    el.dispatchEvent(owned);
    expect(owned.defaultPrevented).toBe(true);
    expect(actions).toEqual(["ollie"]);

    const edge = touchEvent("touchmove", 80, 40);
    el.dispatchEvent(touchEvent("touchend", 200, 120));
    el.dispatchEvent(touchEvent("touchstart", 2, 80));
    el.dispatchEvent(edge);
    expect(edge.defaultPrevented).toBe(false);
    expect(actions).toEqual(["ollie"]);

    el.dispatchEvent(touchEvent("touchcancel", 2, 80));
    stop();
    el.dispatchEvent(touchEvent("touchstart", 200, 200));
    el.dispatchEvent(touchEvent("touchmove", 200, 100));
    expect(actions).toEqual(["ollie"]);
  });
});
