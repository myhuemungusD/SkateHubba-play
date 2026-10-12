import { Capacitor } from "@capacitor/core";
import { playHaptic } from "../services/haptics";
import type { RunnerEvent } from "./types";

/**
 * Light tap on ollie, landing, and the moment a boardslide locks.
 * Web and desktop stay silent — Capacitor's web shim would vibrate Android
 * Chrome, and this phase only wants the native shell.
 */
export function playRunnerHaptic(event: RunnerEvent): void {
  if (!Capacitor.isNativePlatform()) return;
  switch (event) {
    case "ollie":
    case "land":
    case "boardslide":
      playHaptic("toast");
      return;
    case "crash":
      return;
    default: {
      const neverEvent: never = event;
      void neverEvent;
    }
  }
}
