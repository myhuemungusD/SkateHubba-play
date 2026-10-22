import { describe, expect, it, vi } from "vitest";
import type { UploadModerationInput } from "./runUpload.js";

const runUploadModeration = vi.fn<(input: UploadModerationInput) => Promise<string>>(async () => "approved");
const annotateStoredVideo = vi.fn(async () => ({ explicitLikelihoods: [], labels: [] }));

vi.mock("./runUpload.js", () => ({
  runUploadModeration: (input: UploadModerationInput) => runUploadModeration(input),
}));
vi.mock("./video.js", () => ({ annotateStoredVideo: (...args: unknown[]) => annotateStoredVideo(...(args as [])) }));

const { handleClipCreated } = await import("./handlers.js");

describe("handleClipCreated (shared by moderateNewClip and the rescreen script)", () => {
  const db = {} as never;

  it("returns the screener outcome and keeps the trigger's annotate options", async () => {
    const clip = { source: "user", moderation: "pending" };
    await expect(handleClipCreated({ db, enabled: true, sentryDsn: "" }, "c1", clip)).resolves.toBe("approved");
    const input = runUploadModeration.mock.calls[0]?.[0];
    expect(input).toMatchObject({ enabled: true, clipId: "c1", clip });
    await input?.annotate("gs://b/userClips/u/c1.webm");
    expect(annotateStoredVideo).toHaveBeenCalledWith("gs://b/userClips/u/c1.webm", {
      timeoutMs: 240_000,
      pollMs: 2_000,
      getToken: undefined,
    });
  });

  it("forwards an injected token source to Video Intelligence", async () => {
    const getToken = async () => "sa-token";
    runUploadModeration.mockClear();
    annotateStoredVideo.mockClear();
    await handleClipCreated({ db, enabled: true, sentryDsn: "", getToken }, "c2", undefined);
    const input = runUploadModeration.mock.calls[0]?.[0];
    expect(input?.clip).toBeUndefined();
    await input?.annotate("gs://b/x");
    expect(annotateStoredVideo).toHaveBeenCalledWith("gs://b/x", expect.objectContaining({ getToken }));
  });
});
