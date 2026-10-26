import { describe, it, expect, vi, beforeEach } from "vitest";

/* shareText({ nativeFile }): "Share Clip" in the iOS app sends the video file.
 * The clip is downloaded natively into Caches with @capacitor/filesystem,
 * shared with @capacitor/share, then deleted. Any failure short of a
 * user cancel falls back to sharing the link. */

const mockIsNativePlatform = vi.hoisted(() => vi.fn().mockReturnValue(true));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mockIsNativePlatform(), getPlatform: () => "ios" },
}));

// The plugin mock reads `pluginMissing` on every access, so one test can
// make the dynamic import of @capacitor/filesystem fail.
const fsPlugin = vi.hoisted(() => ({
  pluginMissing: false,
  api: { downloadFile: vi.fn(), getUri: vi.fn(), deleteFile: vi.fn() },
}));
const mockShare = vi.hoisted(() => vi.fn());
const { downloadFile: mockDownloadFile, getUri: mockGetUri, deleteFile: mockDeleteFile } = fsPlugin.api;

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Cache: "CACHE" },
  get Filesystem() {
    if (fsPlugin.pluginMissing) throw new Error("no filesystem plugin");
    return fsPlugin.api;
  },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: mockShare } }));

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock("../logger", () => ({
  logger: { warn: mockWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { shareText } from "../nativeBridge";

const CLIP_URL = "https://firebasestorage.googleapis.com/v0/b/b/o/games%2Fg1%2Fturn-1%2Fset-u1.mp4?alt=media&token=t";
const URI = "file:///var/mobile/Containers/Data/Application/X/Library/Caches/skatehubba-kickflip.mp4";
const OPTS = {
  title: "SkateHubba — Kickflip",
  text: "Check out my Kickflip on SkateHubba!",
  textWithoutFiles: "Check out my Kickflip on SkateHubba!\nhttps://skatehubba.com",
  nativeFile: { url: CLIP_URL, filename: "skatehubba-kickflip.mp4" },
};

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  fsPlugin.pluginMissing = false;
  mockIsNativePlatform.mockReturnValue(true);
  mockDownloadFile.mockResolvedValue({ path: URI });
  mockGetUri.mockResolvedValue({ uri: URI });
  mockDeleteFile.mockResolvedValue(undefined);
  mockShare.mockResolvedValue({ activityType: "com.apple.UIKit.activity.Message" });
});

describe("shareText with a native clip file", () => {
  it("downloads the clip to Caches, shares the file itself, and deletes it", async () => {
    await expect(shareText(OPTS)).resolves.toBe("native_share");

    expect(mockDownloadFile).toHaveBeenCalledWith({
      url: CLIP_URL,
      path: "skatehubba-kickflip.mp4",
      directory: "CACHE",
    });
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith({ title: OPTS.title, files: [URI] });
    await flush();
    expect(mockDeleteFile).toHaveBeenCalledWith({ path: "skatehubba-kickflip.mp4", directory: "CACHE" });
  });

  it("keeps the cache path a single flat file name", async () => {
    await shareText({ ...OPTS, nativeFile: { url: CLIP_URL, filename: "skatehubba-50/50 grind.mp4" } });
    expect(mockDownloadFile).toHaveBeenCalledWith(expect.objectContaining({ path: "skatehubba-50-50-grind.mp4" }));
  });

  it("asks for the file URI when the download result has no path", async () => {
    mockDownloadFile.mockResolvedValueOnce({});
    await expect(shareText(OPTS)).resolves.toBe("native_share");
    expect(mockGetUri).toHaveBeenCalledWith({ path: "skatehubba-kickflip.mp4", directory: "CACHE" });
    expect(mockShare).toHaveBeenCalledWith({ title: OPTS.title, files: [URI] });
  });

  it("leaves the title out of the file share when none is given", async () => {
    const { title: _title, ...untitled } = OPTS;
    await shareText(untitled);
    expect(mockShare).toHaveBeenCalledWith({ files: [URI] });
  });

  it("falls back to sharing the link when the download fails", async () => {
    mockDownloadFile.mockRejectedValueOnce(new Error("Error downloading file"));
    await expect(shareText(OPTS)).resolves.toBe("native_share_text");

    expect(mockWarn).toHaveBeenCalledWith("share_file_download_failed", expect.any(Object));
    expect(mockShare).toHaveBeenCalledTimes(1);
    expect(mockShare).toHaveBeenCalledWith({ title: OPTS.title, text: OPTS.textWithoutFiles });
    await flush();
    expect(mockDeleteFile).not.toHaveBeenCalled();
  });

  it("falls back to sharing the link when the filesystem plugin is missing", async () => {
    fsPlugin.pluginMissing = true;
    await expect(shareText(OPTS)).resolves.toBe("native_share_text");
    expect(mockShare).toHaveBeenCalledWith({ title: OPTS.title, text: OPTS.textWithoutFiles });
  });

  it("rejects when the user closes the sheet, and still deletes the file", async () => {
    mockShare.mockRejectedValueOnce(new Error("Share canceled"));
    await expect(shareText(OPTS)).rejects.toThrow("Share canceled");
    expect(mockShare).toHaveBeenCalledTimes(1);
    await flush();
    expect(mockDeleteFile).toHaveBeenCalledWith({ path: "skatehubba-kickflip.mp4", directory: "CACHE" });
  });

  it("falls back to sharing the link when the file share itself fails", async () => {
    mockShare.mockRejectedValueOnce(new Error("UIActivityViewController failed"));
    await expect(shareText(OPTS)).resolves.toBe("native_share_text");
    expect(mockWarn).toHaveBeenCalledWith("share_file_failed", expect.any(Object));
    expect(mockShare).toHaveBeenLastCalledWith({ title: OPTS.title, text: OPTS.textWithoutFiles });
  });

  it("logs a failed cache cleanup without failing the share", async () => {
    mockDeleteFile.mockRejectedValueOnce(new Error("no such file"));
    await expect(shareText(OPTS)).resolves.toBe("native_share");
    await flush();
    expect(mockWarn).toHaveBeenCalledWith("share_file_cleanup_failed", expect.any(Object));
  });

  it("ignores the native file on web", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share });
    await expect(shareText(OPTS)).resolves.toBe("native_share_text");
    expect(mockDownloadFile).not.toHaveBeenCalled();
    expect(share).toHaveBeenCalledWith({ title: OPTS.title, text: OPTS.textWithoutFiles });
    vi.unstubAllGlobals();
  });
});
