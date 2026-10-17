import { describe, expect, it } from "vitest";
import { storageUriFromDownloadUrl } from "./uri.js";

describe("storageUriFromDownloadUrl", () => {
  it("builds a gs uri for a user clip and rejects anything else", () => {
    expect(
      storageUriFromDownloadUrl(
        "https://firebasestorage.googleapis.com/v0/b/sk8hub-d7806.firebasestorage.app/o/userClips%2Fuid%2Fclip.webm?alt=media&token=abc",
      ),
    ).toBe("gs://sk8hub-d7806.firebasestorage.app/userClips/uid/clip.webm");

    expect(storageUriFromDownloadUrl("https://evil.example/userClips/uid/clip.webm")).toBeNull();
    expect(
      storageUriFromDownloadUrl("https://firebasestorage.googleapis.com/v0/b/bucket/o/games%2Fclip.webm"),
    ).toBeNull();
    expect(storageUriFromDownloadUrl("https://firebasestorage.googleapis.com/v0/b//o/userClips%2Fx")).toBeNull();
  });
});
