import { Capacitor } from "@capacitor/core";
import { playHaptic } from "../services/haptics";
import type { RunnerEvent } from "./types";

/**
 * Native shell uses Capacitor. A browser with `navigator.vibrate` gets a
 * short pattern. A bail stays silent. Desktop browsers without vibrate do too.
 */
export function playRunnerHaptic(event: RunnerEvent): void {
  if (event === "bail") return;
  if (Capacitor.isNativePlatform()) {
    playHaptic("toast");
    return;
  }
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  switch (event) {
    case "pop":
      vibrate(12);
      return;
    case "lock":
      vibrate([16, 24, 22]);
      return;
    case "land":
      vibrate(18);
      return;
    case "powerslide":
      vibrate(10);
      return;
    default: {
      const neverEvent: never = event;
      void neverEvent;
    }
  }
}
