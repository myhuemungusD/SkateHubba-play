import { describe, expect, it } from "vitest";
import { isPubliclyApproved, isUserPostedClip } from "../clipVisibility";

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

describe("isUserPostedClip", () => {
  it("passes only a clip whose source is exactly user", () => {
    expect(isUserPostedClip({ source: "user" })).toBe(true);
    expect(isUserPostedClip({ source: "game" })).toBe(false);
    expect(isUserPostedClip({ source: "User" })).toBe(false);
  });

  it("treats a legacy clip with no source, or no data, as a game clip", () => {
    expect(isUserPostedClip({})).toBe(false);
    expect(isUserPostedClip(undefined)).toBe(false);
  });
});
