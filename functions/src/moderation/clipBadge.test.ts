import { describe, expect, it } from "vitest";
import { clipBadgeDelta, nextClipsPosted } from "./clipBadge.js";

describe("clipBadgeDelta", () => {
  it("counts a user clip once, when it is approved", () => {
    expect(clipBadgeDelta({ source: "user" }, "approved")).toBe(1);
    expect(clipBadgeDelta({ source: "user", badgeCounted: true }, "approved")).toBe(0);
    expect(clipBadgeDelta({ source: "game" }, "approved")).toBe(0);
  });

  it("removes the count when an approved clip is rejected, removed, or sent back to review", () => {
    const counted = { source: "user", badgeCounted: true };
    expect(clipBadgeDelta(counted, "rejected")).toBe(-1);
    expect(clipBadgeDelta(counted, "removed")).toBe(-1);
    expect(clipBadgeDelta(counted, "review")).toBe(-1);
    expect(clipBadgeDelta({ source: "user" }, "rejected")).toBe(0);
    expect(clipBadgeDelta({ source: "user" }, "review")).toBe(0);
  });
});

describe("nextClipsPosted", () => {
  it("floors at zero and ignores a non-numeric prior", () => {
    expect(nextClipsPosted(4, 1)).toBe(5);
    expect(nextClipsPosted(0, -1)).toBe(0);
    expect(nextClipsPosted("nope", 1)).toBe(1);
  });
});
