import { describe, it, expect } from "vitest";
import { clipExtFromUrl, clipFileName, clipFileType } from "../clipFile";

describe("clipFileType", () => {
  it("keeps known video types with the matching extension", () => {
    expect(clipFileType("video/mp4")).toEqual({ mime: "video/mp4", ext: "mp4" });
    expect(clipFileType("video/quicktime")).toEqual({ mime: "video/quicktime", ext: "mov" });
    expect(clipFileType("video/webm")).toEqual({ mime: "video/webm", ext: "webm" });
  });

  it("ignores codec parameters and case", () => {
    expect(clipFileType("Video/MP4; codecs=avc1")).toEqual({ mime: "video/mp4", ext: "mp4" });
  });

  it("defaults unknown or missing types to mp4", () => {
    expect(clipFileType("")).toEqual({ mime: "video/mp4", ext: "mp4" });
    expect(clipFileType(undefined)).toEqual({ mime: "video/mp4", ext: "mp4" });
    expect(clipFileType("application/octet-stream")).toEqual({ mime: "video/mp4", ext: "mp4" });
  });
});

describe("clipFileName", () => {
  it("slugs the trick name", () => {
    expect(clipFileName("Tre  Flip", "mp4")).toBe("skatehubba-tre-flip.mp4");
  });
});

describe("clipExtFromUrl", () => {
  it("reads the extension from an encoded Storage download URL", () => {
    expect(
      clipExtFromUrl(
        "https://firebasestorage.googleapis.com/v0/b/b/o/games%2Fg%2Fturn-1%2Fset-u.webm?alt=media&token=t",
      ),
    ).toBe("webm");
    expect(clipExtFromUrl("https://cdn.example.com/clips/a.MOV")).toBe("mov");
  });

  it("matches the raw string when the URL can't be parsed", () => {
    expect(clipExtFromUrl("not a url/clip.webm?x=1")).toBe("webm");
    expect(clipExtFromUrl("https://x.test/%E0%A4%A.mp4")).toBe("mp4");
  });

  it("defaults to mp4", () => {
    expect(clipExtFromUrl("https://x.test/clip")).toBe("mp4");
  });
});
