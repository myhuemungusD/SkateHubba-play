import { describe, expect, it, vi } from "vitest";
import type { VideoAnnotation } from "./decide.js";
import { runUploadModeration, type UploadModerationInput } from "./runUpload.js";

const clip = {
  source: "user",
  moderation: "pending",
  playerUid: "owner",
  videoUrl:
    "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/userClips%2Fowner%2Fclip1.webm?alt=media",
};

function harness(overrides: Partial<UploadModerationInput> = {}) {
  const save = vi.fn(async () => true);
  const notify = vi.fn(async () => undefined);
  const capture = vi.fn(async () => undefined);
  const annotate = vi.fn(async (): Promise<VideoAnnotation> => ({ explicitLikelihoods: [], labels: [] }));
  const input: UploadModerationInput = {
    enabled: true,
    clipId: "clip1",
    clip,
    annotate,
    save,
    notify,
    capture,
    ...overrides,
  };
  return { input, save, notify, capture, annotate };
}

describe("runUploadModeration", () => {
  it("does nothing when the server switch is off or the clip is not a pending public upload", async () => {
    const off = harness({ enabled: false });
    await expect(runUploadModeration(off.input)).resolves.toBe("skipped");
    expect(off.save).not.toHaveBeenCalled();

    const game = harness({ clip: { source: "game", moderation: "pending" } });
    await expect(runUploadModeration(game.input)).resolves.toBe("skipped");

    const approved = harness({ clip: { ...clip, moderation: "approved" } });
    await expect(runUploadModeration(approved.input)).resolves.toBe("skipped");
  });

  it("sends an unreadable video to review and alerts Sentry", async () => {
    const { input, save, capture, notify } = harness({ clip: { ...clip, videoUrl: "https://evil.example/x" } });
    await expect(runUploadModeration(input)).resolves.toBe("review");
    expect(capture).toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ moderation: "review", moderationStatus: "hidden" }),
      "pending-only",
    );
    expect(notify).not.toHaveBeenCalled();
    const patch = save.mock.calls[0]?.[0] as { moderation: string };
    expect(patch.moderation).not.toBe("approved");
  });

  it("sends an API failure to review and never approves", async () => {
    const { input, save, capture, annotate } = harness();
    annotate.mockRejectedValue(new Error("timed out"));
    await expect(runUploadModeration(input)).resolves.toBe("review");
    expect(capture).toHaveBeenCalled();
    const patch = save.mock.calls[0]?.[0] as { moderation: string; moderationScores: { error: string } };
    expect(patch.moderation).toBe("review");
    expect(patch.moderationScores.error).toBe("timed out");
  });

  it("still reviews the clip when Sentry itself throws", async () => {
    const { input, save, capture } = harness({ clip: { ...clip, videoUrl: "" } });
    capture.mockRejectedValue(new Error("sentry down"));
    await expect(runUploadModeration(input)).resolves.toBe("review");
    expect(save).toHaveBeenCalled();
  });

  it("rejects explicit footage and tells the owner", async () => {
    const { input, annotate, notify, save } = harness();
    annotate.mockResolvedValue({
      explicitLikelihoods: ["VERY_LIKELY"],
      labels: [{ description: "skateboard", confidence: 0.9 }],
    });
    await expect(runUploadModeration(input)).resolves.toBe("rejected");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ moderation: "rejected" }), "pending-only");
    expect(notify).toHaveBeenCalledWith("owner", expect.objectContaining({ decision: "rejected", automated: true }));
  });

  it("approves a skate clip that is not explicit, without notifying", async () => {
    const { input, annotate, notify } = harness();
    annotate.mockResolvedValue({
      explicitLikelihoods: ["UNLIKELY"],
      labels: [{ description: "skateboarding", confidence: 0.88 }],
    });
    await expect(runUploadModeration(input)).resolves.toBe("approved");
    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify when the clip is no longer pending", async () => {
    const { input, annotate, notify, save } = harness();
    save.mockResolvedValue(false);
    annotate.mockResolvedValue({
      explicitLikelihoods: ["LIKELY"],
      labels: [],
    });
    await expect(runUploadModeration(input)).resolves.toBe("skipped");
    expect(notify).not.toHaveBeenCalled();
  });
});
