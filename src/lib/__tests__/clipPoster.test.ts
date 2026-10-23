import { describe, it, expect } from "vitest";
import { CLIP_PLACEHOLDER, withFirstFrame } from "../clipPoster";
import { LANDING_VIDEO_POSTER } from "../../components/LandingDemoVideo";

const FIREBASE =
  "https://firebasestorage.googleapis.com/v0/b/app.firebasestorage.app/o/games%2Fg1%2Fturn-1%2Fset.mp4?alt=media&token=abc";

describe("withFirstFrame", () => {
  it("appends a t= fragment after the query string, leaving it intact", () => {
    expect(withFirstFrame(FIREBASE)).toBe(`${FIREBASE}#t=0.1`);
  });

  it("appends to plain and blob URLs", () => {
    expect(withFirstFrame("https://cdn/clip.mp4")).toBe("https://cdn/clip.mp4#t=0.1");
    expect(withFirstFrame("blob:capacitor://localhost/123")).toBe("blob:capacitor://localhost/123#t=0.1");
  });

  it("extends an existing fragment instead of adding a second #", () => {
    expect(withFirstFrame("https://cdn/clip.mp4#xywh=0,0,10,10")).toBe("https://cdn/clip.mp4#xywh=0,0,10,10&t=0.1");
    expect(withFirstFrame("https://cdn/clip.mp4#")).toBe("https://cdn/clip.mp4#t=0.1");
  });

  it("leaves a URL that already names a start time alone", () => {
    expect(withFirstFrame("https://cdn/clip.mp4#t=2")).toBe("https://cdn/clip.mp4#t=2");
    expect(withFirstFrame("https://cdn/clip.mp4#a=1&t=2")).toBe("https://cdn/clip.mp4#a=1&t=2");
  });

  it("returns an empty URL unchanged", () => {
    expect(withFirstFrame("")).toBe("");
  });
});

describe("CLIP_PLACEHOLDER", () => {
  it("is never the landing promo still (a stranger's clip on someone's own trick)", () => {
    expect(CLIP_PLACEHOLDER).toBe("/clip-placeholder.webp");
    expect(CLIP_PLACEHOLDER).not.toBe(LANDING_VIDEO_POSTER);
  });
});
