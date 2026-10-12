export type RunnerQuality = "low" | "high";

export interface DeviceProfile {
  userAgent: string;
  /** GB, when the browser reports it. Null when the API is missing. */
  deviceMemory: number | null;
  hardwareConcurrency: number | null;
}

/**
 * Phones and small laptops stay on the low tier: blob shadow, no shadow map,
 * no fullscreen pass. Desktop keeps one soft shadow map. Lamp glow is baked
 * either way, so the low tier does not need a postprocessing pass.
 */
export function runnerQualityFor(profile: DeviceProfile): RunnerQuality {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(profile.userAgent)) return "low";
  if (profile.deviceMemory !== null && profile.deviceMemory <= 4) return "low";
  if (profile.hardwareConcurrency !== null && profile.hardwareConcurrency <= 4) return "low";
  return "high";
}

export function currentRunnerQuality(): RunnerQuality {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return runnerQualityFor({
    userAgent: nav.userAgent,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
    hardwareConcurrency: typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
  });
}
