import { describe, expect, it } from "vitest";
import { isPubliclyApproved } from "../clipVisibility";

describe("isPubliclyApproved", () => {
  it("shows legacy active clips and approved clips", () => {
    expect(isPubliclyApproved({ moderationStatus: "active" })).toBe(true);
    expect(isPubliclyApproved({})).toBe(true);
    expect(isPubliclyApproved({ moderationStatus: "active", moderation: "approved" })).toBe(true);
    expect(isPubliclyApproved({ moderationStatus: "active", moderation: "" })).toBe(true);
  });

  it("hides pending, hidden, and any non-approved workflow value", () => {
    expect(isPubliclyApproved({ moderationStatus: "pending", moderation: "pending" })).toBe(false);
    expect(isPubliclyApproved({ moderationStatus: "hidden" })).toBe(false);
    expect(isPubliclyApproved({ moderationStatus: "active", moderation: "review" })).toBe(false);
    expect(isPubliclyApproved({ moderationStatus: "active", moderation: "rejected" })).toBe(false);
    expect(isPubliclyApproved({ moderationStatus: "active", moderation: "removed" })).toBe(false);
    expect(isPubliclyApproved({ moderationStatus: "active", moderation: "nope" })).toBe(false);
  });
});
