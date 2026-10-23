import { describe, it, expect } from "vitest";
import { clipFileName, clipFileType } from "../clipFile";

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
