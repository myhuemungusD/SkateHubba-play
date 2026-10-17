import { describe, expect, it, vi } from "vitest";
import { downloadUrlFor, parseClipStorageUrl, reconcileClipVideo, type ClipObjectStore } from "./publish.js";

const PRIVATE =
  "https://firebasestorage.googleapis.com/v0/b/bucket.firebasestorage.app/o/userClips%2Fowner%2Fclip.webm?alt=media&token=a";
const PUBLIC =
  "https://firebasestorage.googleapis.com/v0/b/bucket.firebasestorage.app/o/approvedClips%2Fowner%2Fclip.webm?alt=media&token=b";

function store(): ClipObjectStore & { copy: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> } {
  return {
    copy: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    downloadUrl: vi.fn(async (_bucket: string, path: string) =>
      downloadUrlFor("bucket.firebasestorage.app", path, "t"),
    ),
  };
}

describe("reconcileClipVideo", () => {
  it("parses only this project's user-clip download URLs", () => {
    expect(parseClipStorageUrl(PRIVATE)).toEqual({
      bucket: "bucket.firebasestorage.app",
      path: "userClips/owner/clip.webm",
    });
    expect(parseClipStorageUrl("https://evil.example/userClips/owner/clip.webm")).toBeNull();
    expect(parseClipStorageUrl("https://firebasestorage.googleapis.com/v0/b/bucket/o/games%2Fx.webm")).toBeNull();
  });

  it("copies a private object onto the approved path when the clip is approved", async () => {
    const media = store();
    const next = await reconcileClipVideo(media, { ownerUid: "owner", videoUrl: PRIVATE, visible: true });
    expect(media.copy).toHaveBeenCalledWith(
      "bucket.firebasestorage.app",
      "userClips/owner/clip.webm",
      "approvedClips/owner/clip.webm",
    );
    expect(next).toContain("approvedClips%2Fowner%2Fclip.webm");
  });

  it("leaves an already-approved URL in place", async () => {
    const media = store();
    await expect(reconcileClipVideo(media, { ownerUid: "owner", videoUrl: PUBLIC, visible: true })).resolves.toBeNull();
    expect(media.copy).not.toHaveBeenCalled();
  });

  it("moves a hidden clip back to the private path and deletes the public object", async () => {
    const media = store();
    const next = await reconcileClipVideo(media, { ownerUid: "owner", videoUrl: PUBLIC, visible: false });
    expect(media.copy).toHaveBeenCalledWith(
      "bucket.firebasestorage.app",
      "approvedClips/owner/clip.webm",
      "userClips/owner/clip.webm",
    );
    expect(media.remove).toHaveBeenCalledWith("bucket.firebasestorage.app", "approvedClips/owner/clip.webm");
    expect(next).toContain("userClips%2Fowner%2Fclip.webm");
  });

  it("deletes a public twin when the doc still points at the private object", async () => {
    const media = store();
    await expect(
      reconcileClipVideo(media, { ownerUid: "owner", videoUrl: PRIVATE, visible: false }),
    ).resolves.toBeNull();
    expect(media.remove).toHaveBeenCalledWith("bucket.firebasestorage.app", "approvedClips/owner/clip.webm");
  });
});
