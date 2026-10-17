import { describe, it, expect } from "vitest";
import { toDateOrNull } from "../closet.time";

describe("toDateOrNull", () => {
  it("unwraps a timestamp-like value", () => {
    const when = new Date("2026-10-17T12:00:00Z");
    expect(toDateOrNull({ toDate: () => when })).toBe(when);
  });

  it("rejects missing, primitive, toDate-less and invalid values", () => {
    expect(toDateOrNull(null)).toBeNull();
    expect(toDateOrNull("2026-10-17")).toBeNull();
    expect(toDateOrNull({})).toBeNull();
    expect(toDateOrNull({ toDate: () => "nope" })).toBeNull();
    expect(toDateOrNull({ toDate: () => new Date("bad") })).toBeNull();
  });
});
