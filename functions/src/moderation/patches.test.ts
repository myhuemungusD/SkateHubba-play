import { describe, expect, it } from "vitest";
import {
  adminPatch,
  autoHidePatch,
  failurePatch,
  shouldApplyUploadDecision,
  shouldAutoHideClip,
  uploadPatch,
} from "./patches.js";

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
    const rejected = uploadPatch({
      decision: "rejected",
      explicitLikelihood: "VERY_LIKELY",
      skateDetected: false,
      skateLabels: [],
      grounds: "explicit content",
    });
    expect(rejected.patch).toMatchObject({ moderation: "rejected", moderationStatus: "hidden" });
    expect(rejected.statement?.appealPath).toBe("/settings#safety-reports");

    const review = uploadPatch({
      decision: "review",
      explicitLikelihood: "UNLIKELY",
      skateDetected: false,
      skateLabels: [],
      grounds: "no skateboard detected",
    });
    expect(review.patch).toMatchObject({ moderation: "review", moderationStatus: "hidden" });
    expect(review.statement).toBeNull();

    const approved = uploadPatch({
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
    expect(adminPatch("approved", "").patch).toMatchObject({
      moderation: "approved",
      moderationStatus: "active",
    });
    expect(adminPatch("removed", "  not skating  ").statement?.grounds).toBe("not skating");
    expect(() => adminPatch("removed", "   ")).toThrow(/reason is required/);
  });

  it("writes an appealable statement when the community auto-hides a clip", () => {
    const hidden = autoHidePatch(["not_skating", "inappropriate"]);
    expect(hidden.guard).toBe("hide-if-open");
    expect(hidden.statement?.appealPath).toBe("/settings#safety-reports");
    expect(hidden.statement?.automated).toBe(true);
    expect(hidden.patch.moderationNotice).toBe(hidden.statement);
    expect(hidden.patch).toMatchObject({ moderation: "review", moderationStatus: "hidden" });
  });
});
