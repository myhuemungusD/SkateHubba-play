import type { Action } from "./types";

export type KeyAction = Action | "pause";

export function actionForKey(key: string): KeyAction | null {
  switch (key) {
    case "ArrowLeft":
    case "a":
    case "A":
      return "left";
    case "ArrowRight":
    case "d":
    case "D":
      return "right";
    case "ArrowUp":
    case "w":
    case "W":
    case "f":
    case "F":
      return "tap";
    case " ":
    case "k":
    case "K":
      return "flip";
    case "ArrowDown":
    case "s":
    case "S":
      return "duck";
    case "Escape":
    case "p":
    case "P":
      return "pause";
    default:
      return null;
  }
}

/** Ignore keys aimed at a text field so a future input cannot fire a trick by accident. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA";
}
