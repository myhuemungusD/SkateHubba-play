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

/**
 * Standard button intents shared across Btn and SkateButton. Kept in sync with
 * `Btn`'s variant prop so both primitives map identical intents to identical
 * haptic weights.
 */
export type ButtonVariant = "primary" | "secondary" | "success" | "danger" | "ghost";

/**
 * Map button variants to the haptic vocabulary. Primary/success/danger are
 * the weight-class CTAs users consciously commit to (Challenge, Land It,
 * Delete), so they get Medium impact. Secondary / ghost are navigational or
 * cancel-ish — Light impact keeps the feedback proportional to intent.
 * `toast` is the lightest pulse we have; `button_primary` is medium.
 */
const variantHaptic: Record<ButtonVariant, HapticType> = {
  primary: "button_primary",
  success: "button_primary",
  danger: "button_primary",
  secondary: "toast",
  ghost: "toast",
};

/**
 * Resolve the canonical haptic for a button variant.
 *
 * - A missing variant (`null` / `undefined`) maps to the `primary` haptic so
 *   it stays aligned with `Btn`'s default `variant="primary"` rendering.
 * - An unknown variant string falls back to `"toast"` (the lightest pulse)
 *   so a stray/legacy variant never silences the tap entirely.
 */
export function hapticForVariant(variant: ButtonVariant | null | undefined): HapticType {
  if (!variant) return variantHaptic.primary;
  return variantHaptic[variant] ?? "toast";
}

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
