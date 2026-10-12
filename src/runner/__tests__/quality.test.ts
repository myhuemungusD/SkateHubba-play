import { describe, expect, it } from "vitest";
import { runnerDpr, runnerQualityFor, runnerUsesBloom } from "../quality";
import { BLOOM_MIPS, BLOOM_THRESHOLD } from "../tune";

describe("runner quality", () => {
  it("drops phones and small devices to the low tier", () => {
    expect(
      runnerQualityFor({
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148",
        deviceMemory: 8,
        hardwareConcurrency: 8,
      }),
    ).toBe("low");
    expect(
      runnerQualityFor({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
        deviceMemory: 4,
        hardwareConcurrency: 8,
      }),
    ).toBe("low");
    expect(
      runnerQualityFor({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
        deviceMemory: null,
        hardwareConcurrency: 4,
      }),
    ).toBe("low");
  });

  it("keeps a desktop on the high tier", () => {
    expect(
      runnerQualityFor({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
        deviceMemory: 16,
        hardwareConcurrency: 8,
      }),
    ).toBe("high");
    expect(
      runnerQualityFor({
        userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
        deviceMemory: null,
        hardwareConcurrency: null,
      }),
    ).toBe("high");
  });

  it("keeps bloom and the higher pixel ratio on the desktop tier only", () => {
    expect(runnerDpr("low")).toEqual([1, 1]);
    expect(runnerDpr("high")).toEqual([1, 1.5]);
    expect(runnerUsesBloom("low")).toBe(false);
    expect(runnerUsesBloom("high")).toBe(true);
    expect(BLOOM_MIPS).toBeGreaterThanOrEqual(4);
    expect(BLOOM_MIPS).toBeLessThanOrEqual(5);
    expect(BLOOM_THRESHOLD).toBeGreaterThanOrEqual(0.9);
  });
});
