import { describe, expect, it } from "vitest";
import { BELOW_HEADER, FEED_TOP_STACK, belowTopStack } from "../feedLayout";

describe("feedLayout top stack", () => {
  it("pins the stack under the top safe area, never at a fixed offset", () => {
    expect(FEED_TOP_STACK).toContain("pt-safe");
    expect(FEED_TOP_STACK).toContain("top-0");
    expect(FEED_TOP_STACK).not.toMatch(/top-(1[0-9]|[2-9]\d)/);
  });

  it("clears one more 2.75rem row per optional row, always from the safe area", () => {
    expect(belowTopStack(0)).toBe("top-[calc(max(env(safe-area-inset-top),1.25rem)+4.25rem)]");
    expect(belowTopStack(1)).toBe("top-[calc(max(env(safe-area-inset-top),1.25rem)+7rem)]");
    expect(belowTopStack(2)).toBe("top-[calc(max(env(safe-area-inset-top),1.25rem)+9.75rem)]");
    expect(belowTopStack(-1)).toBe(belowTopStack(0));
    expect(belowTopStack(9)).toBe(belowTopStack(2));
  });

  it("BELOW_HEADER is one of the safe-area-aware stack offsets", () => {
    expect([0, 1, 2].map(belowTopStack)).toContain(BELOW_HEADER);
  });
});
