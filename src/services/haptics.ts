/**
 * Haptic feedback service — mirrors sounds.ts architecture.
 *
 * Maps named game/UI events to Capacitor Haptics calls. On iOS/Android this
 * drives the native Taptic Engine / vibrator; on the web it falls through to
 * navigator.vibrate (Android Chrome) or silently no-ops (iOS Safari, no API).
 *
 * Preference persisted to localStorage, on by default. All calls are
 * fire-and-forget and fail silently when the platform is unavailable.
 */

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export type HapticType =
  | "trick_landed"
  | "trick_missed"
  | "game_won"
  | "game_lost"
  | "new_challenge"
  | "your_turn"
  | "nudge"
  | "button_primary"
  | "toast";

const STORAGE_KEY = "skate_haptics_enabled";

/* ── Preference ────────────────────────────── */

export function isHapticsEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === "1";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* quota exceeded — ignore */
  }
}

/* ── Dispatch ──────────────────────────────── */

function trigger(type: HapticType): Promise<void> {
  switch (type) {
    case "trick_landed":
    case "game_won":
      return Haptics.notification({ type: NotificationType.Success });
    case "trick_missed":
    case "game_lost":
      return Haptics.notification({ type: NotificationType.Error });
    case "nudge":
      return Haptics.notification({ type: NotificationType.Warning });
    case "new_challenge":
      return Haptics.impact({ style: ImpactStyle.Heavy });
    case "your_turn":
    case "button_primary":
      return Haptics.impact({ style: ImpactStyle.Medium });
    case "toast":
      return Haptics.impact({ style: ImpactStyle.Light });
  }
}

/* ── Public API ────────────────────────────── */

export function playHaptic(type: HapticType): void {
  if (!isHapticsEnabled()) return;
  try {
    trigger(type).catch(() => {
      /* platform unavailable (e.g. iOS Safari) — fail silently */
    });
  } catch {
    /* Haptics plugin not loaded — fail silently */
  }
}
