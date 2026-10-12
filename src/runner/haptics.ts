import { Capacitor } from "@capacitor/core";
import { playHaptic } from "../services/haptics";
import type { RunnerEvent } from "./types";

/**
 * Light tap on a powerslide, a grind lock, and the landing off it.
 * Web and desktop stay silent — Capacitor's web shim would vibrate Android
 * Chrome, and this phase only wants the native shell. A bail is silent.
 */
export function playRunnerHaptic(event: RunnerEvent): void {
  if (!Capacitor.isNativePlatform()) return;
  switch (event) {
    case "powerslide":
    case "lock":
    case "land":
      playHaptic("toast");
      return;
    case "bail":
      return;
    default: {
      const neverEvent: never = event;
      void neverEvent;
    }
  }
}
