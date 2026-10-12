export type RunnerQuality = "low" | "high";

export interface DeviceProfile {
  userAgent: string;
  /** GB, when the browser reports it. Null when the API is missing. */
  deviceMemory: number | null;
  hardwareConcurrency: number | null;
}

/**
 * Phones and small laptops stay on the low tier: pixel ratio 1, blob shadow,
 * no shadow map, no bloom. Desktop keeps one soft shadow map and a short
 * bloom pass. Lamp glow is an additive card on both tiers, so the phone
 * still shows the sodium lamps when the fullscreen pass is off.
 */
export function runnerQualityFor(profile: DeviceProfile): RunnerQuality {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(profile.userAgent)) return "low";
  if (profile.deviceMemory !== null && profile.deviceMemory <= 4) return "low";
  if (profile.hardwareConcurrency !== null && profile.hardwareConcurrency <= 4) return "low";
  return "high";
}

/** Canvas device-pixel-ratio range. Phones stay at 1 so a 4× CPU throttle can hold 60fps. */
export function runnerDpr(quality: RunnerQuality): [number, number] {
  switch (quality) {
    case "high":
      return [1, 1.5];
    case "low":
      return [1, 1];
    default: {
      const neverQuality: never = quality;
      return neverQuality;
    }
  }
}

/** Bloom is the desktop pass. The phone tier draws the lamps without it. */
export function runnerUsesBloom(quality: RunnerQuality): boolean {
  switch (quality) {
    case "high":
      return true;
    case "low":
      return false;
    default: {
      const neverQuality: never = quality;
      return neverQuality;
    }
  }
}

export function currentRunnerQuality(): RunnerQuality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return runnerQualityFor({
    userAgent: nav.userAgent,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    hardwareConcurrency: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
  });
}
