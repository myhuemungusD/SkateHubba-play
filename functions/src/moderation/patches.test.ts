import { describe, expect, it } from "vitest";
import { adminPatch, failurePatch, shouldApplyUploadDecision, shouldAutoHideClip, uploadPatch } from "./patches.js";

describe("clip patches", () => {
  it("only applies an upload decision while the clip is pending", () => {
    expect(shouldApplyUploadDecision("pending")).toBe(true);
    expect(shouldApplyUploadDecision("review")).toBe(false);
    expect(shouldApplyUploadDecision(undefined)).toBe(false);
  });

  it("auto-hides public clips that are not already decided or in review", () => {
    expect(shouldAutoHideClip({ source: "user", moderation: "approved" })).toBe(true);
    expect(shouldAutoHideClip({ source: "user", moderation: "pending" })).toBe(true);
    expect(shouldAutoHideClip({ source: "user", moderation: "review" })).toBe(false);
    expect(shouldAutoHideClip({ source: "user", moderation: "rejected" })).toBe(false);
    expect(shouldAutoHideClip({ source: "user", moderation: "removed" })).toBe(false);
    expect(shouldAutoHideClip({ source: "game", moderation: "approved" })).toBe(false);
  });

  it("maps each upload outcome onto the feed visibility field", () => {
    const rejected = uploadPatch("c1", {
      decision: "rejected",
      explicitLikelihood: "VERY_LIKELY",
      skateDetected: false,
      skateLabels: [],
      grounds: "explicit content",
    });
    expect(rejected.patch).toMatchObject({ moderation: "rejected", moderationStatus: "hidden" });
    expect(rejected.statement?.appealPath).toBe("/appeal/clip_c1");

    const review = uploadPatch("c1", {
      decision: "review",
      explicitLikelihood: "UNLIKELY",
      skateDetected: false,
      skateLabels: [],
      grounds: "no skateboard detected",
    });
    expect(review.patch).toMatchObject({ moderation: "review", moderationStatus: "hidden" });
    expect(review.statement).toBeNull();

    const approved = uploadPatch("c1", {
      decision: "approved",
      explicitLikelihood: "UNLIKELY",
      skateDetected: true,
      skateLabels: ["skateboard"],
      grounds: "skateboarding",
    });
    expect(approved.patch).toMatchObject({ moderation: "approved", moderationStatus: "active" });
  });

  it("fails safe to review and requires a reason to remove", () => {
    expect(failurePatch("timed out").patch).toMatchObject({
      moderation: "review",
      moderationScores: { error: "timed out" },
    });
    expect(adminPatch("c1", "approved", "").patch).toMatchObject({
      moderation: "approved",
      moderationStatus: "active",
    });
    expect(adminPatch("c1", "removed", "  not skating  ").statement?.grounds).toBe("not skating");
    expect(() => adminPatch("c1", "removed", "   ")).toThrow(/reason is required/);
  });
});
