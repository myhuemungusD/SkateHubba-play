import { describe, it, expect, vi, afterEach } from "vitest";
import { appOrigin, ownClipShareOptions, publicProfileUrl } from "../clipShare";

const TOKEN_URL = "https://firebasestorage.googleapis.com/v0/b/x/o/clip.webm?alt=media&token=secret-token";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("appOrigin / publicProfileUrl", () => {
  it("prefers the build's VITE_APP_URL, so the app shell never shares capacitor://localhost", () => {
    vi.stubEnv("VITE_APP_URL", "https://skatehubba.test");
    expect(appOrigin()).toBe("https://skatehubba.test");
    expect(publicProfileUrl("u42")).toBe("https://skatehubba.test/player/u42");
  });

  it("falls back to the page origin when VITE_APP_URL is unset", () => {
    vi.stubEnv("VITE_APP_URL", "");
    expect(appOrigin()).toBe(window.location.origin);
    expect(publicProfileUrl("u42")).toBe(`${window.location.origin}/player/u42`);
  });
});

describe("ownClipShareOptions", () => {
  it("shares the native file under a flat name and falls back to a link to the owner's profile", () => {
    vi.stubEnv("VITE_APP_URL", "https://skatehubba.test");
    const opts = ownClipShareOptions({ videoUrl: TOKEN_URL, trickName: "50/50", ownerUid: "u42" });

    expect(opts.title).toBe("SkateHubba — 50/50");
    expect(opts.text).toBe("Check out my 50/50 on SkateHubba!");
    expect(opts.nativeFile).toEqual({ url: TOKEN_URL, filename: "skatehubba-50-50.webm" });
    expect(opts.textWithoutFiles).toBe("Check out my 50/50 on SkateHubba!\nhttps://skatehubba.test/player/u42");
    // Only the native file carries the download URL; nothing in the text does.
    expect(`${opts.text}${opts.textWithoutFiles}`).not.toContain("secret-token");
  });

  it("loads the clip as a File typed from the downloaded blob", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, blob: () => Promise.resolve(new Blob(["v"], { type: "video/mp4" })) });
    vi.stubGlobal("fetch", fetchMock);
    const { loadFiles } = ownClipShareOptions({ videoUrl: TOKEN_URL, trickName: "50/50", ownerUid: "u42" });

    const files = await loadFiles!();

    expect(fetchMock).toHaveBeenCalledWith(TOKEN_URL);
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("skatehubba-50-50.mp4");
    expect(files[0].type).toBe("video/mp4");
  });

  it("rejects loadFiles when the download fails, so the bridge falls back to text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const { loadFiles } = ownClipShareOptions({ videoUrl: TOKEN_URL, trickName: "Kickflip", ownerUid: "u42" });

    await expect(loadFiles!()).rejects.toThrow("Fetch failed");
  });
});
