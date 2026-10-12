import { Capacitor } from "@capacitor/core";
import { isHapticsEnabled, playHaptic } from "../services/haptics";
import { HAPTIC_GAP_MS } from "./tune";
import type { Grade, RunnerEvent } from "./types";

let lastBuzz = -Infinity;

/**
 * Native shell uses Capacitor impact and notification styles.
 * A browser with `navigator.vibrate` gets a short pattern.
 * The shared haptics setting turns both off. At most one buzz per 50 ms.
 */
export function playRunnerHaptic(event: RunnerEvent, grade: Grade | null = null, now = Date.now()): void {
  if (!isHapticsEnabled()) return;
  if (now - lastBuzz < HAPTIC_GAP_MS) return;
  lastBuzz = now;
  if (Capacitor.isNativePlatform()) {
    buzzNative(event, grade);
    return;
  }
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  switch (event) {
    case "pop":
      vibrate(12);
      return;
    case "lock":
      vibrate([18, 20, 28]);
      return;
    case "land":
      vibrate(grade === "perfect" ? [10, 30, 40] : 18);
      return;
    case "powerslide":
      vibrate(10);
      return;
    case "bail":
      vibrate([40, 30, 80]);
      return;
    default: {
      const neverEvent: never = event;
      void neverEvent;
    }
  }
}

/** Light pulse while a grind is held. The lock itself is the medium hit. */
export function pulseGrindHaptic(now = Date.now()): void {
  if (!isHapticsEnabled()) return;
  if (now - lastBuzz < HAPTIC_GAP_MS) return;
  lastBuzz = now;
  if (Capacitor.isNativePlatform()) {
    playHaptic("toast");
    return;
  }
  const vibrate = navigator.vibrate?.bind(navigator);
  vibrate?.(8);
}

function buzzNative(event: RunnerEvent, grade: Grade | null): void {
  switch (event) {
    case "pop":
    case "powerslide":
      playHaptic("toast");
      return;
    case "lock":
      playHaptic("button_primary");
      return;
    case "land":
      playHaptic(grade === "perfect" ? "trick_landed" : "toast");
      return;
    case "bail":
      playHaptic("new_challenge");
      playHaptic("game_lost");
      return;
    default: {
      const neverEvent: never = event;
      void neverEvent;
    }
  }
}
