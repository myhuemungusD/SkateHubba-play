import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* saveTextFile: the "Download my data" save path. Web keeps the blob
 * <a download>; the native shells write to Caches with @capacitor/filesystem
 * and open the share sheet with @capacitor/share. */

const mockIsNativePlatform = vi.hoisted(() => vi.fn().mockReturnValue(false));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => mockIsNativePlatform(), getPlatform: () => "ios" },
}));

const { mockWriteFile, mockDeleteFile, mockShare, failFsImport } = vi.hoisted(() => ({
  mockWriteFile: vi.fn(),
  mockDeleteFile: vi.fn(),
  mockShare: vi.fn(),
  failFsImport: { value: false },
}));

vi.mock("@capacitor/filesystem", () => ({
  get Filesystem() {
    if (failFsImport.value) throw new Error("filesystem plugin unavailable");
    return { writeFile: mockWriteFile, deleteFile: mockDeleteFile };
  },
  Directory: { Cache: "CACHE" },
  Encoding: { UTF8: "utf8" },
}));
vi.mock("@capacitor/share", () => ({ Share: { share: mockShare } }));

const mockWarn = vi.hoisted(() => vi.fn());
vi.mock("../logger", () => ({
  logger: { warn: mockWarn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { saveTextFile, SAVE_FILE_FAILED_MESSAGE } from "../nativeBridge";

const FILE = {
  filename: "skatehubba-data-kickflip-2026-10-23.json",
  text: '{"ok":true}',
  mimeType: "application/json",
  title: "Your SkateHubba data",
};
const URI = "file:///var/mobile/Containers/Data/Application/X/Library/Caches/skatehubba-data-kickflip-2026-10-23.json";

/** Let the fire-and-forget cache cleanup settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.clearAllMocks();
  failFsImport.value = false;
  mockIsNativePlatform.mockReturnValue(true);
  mockWriteFile.mockResolvedValue({ uri: URI });
  mockDeleteFile.mockResolvedValue(undefined);
  mockShare.mockResolvedValue({ activityType: "com.apple.DocumentManagerUICore.SaveToFiles" });
});

describe("saveTextFile on native (iOS / Android shell)", () => {
  it("writes the file to Caches, opens the share sheet on it, and resolves shared", async () => {
    await expect(saveTextFile(FILE)).resolves.toBe("shared");

    expect(mockWriteFile).toHaveBeenCalledWith({
      path: FILE.filename,
      data: FILE.text,
      directory: "CACHE",
      encoding: "utf8",
    });
    expect(mockShare).toHaveBeenCalledWith({ title: FILE.title, files: [URI] });
    await flush();
    expect(mockDeleteFile).toHaveBeenCalledWith({ path: FILE.filename, directory: "CACHE" });
  });

  it("leaves the title out of the share call when none is given", async () => {
    const { title: _title, ...untitled } = FILE;
    await saveTextFile(untitled);
    expect(mockShare).toHaveBeenCalledWith({ files: [URI] });
  });

  it("never starts a browser download inside the shell", async () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL });
    await saveTextFile(FILE);
    expect(createObjectURL).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("resolves cancelled, not an error, when the user closes the sheet", async () => {
    mockShare.mockRejectedValueOnce(new Error("Share canceled"));
    await expect(saveTextFile(FILE)).resolves.toBe("cancelled");
    expect(mockWarn).not.toHaveBeenCalled();
    await flush();
    expect(mockDeleteFile).toHaveBeenCalledTimes(1);
  });

  it("rejects with the user-facing message when the share sheet fails", async () => {
    const cause = new Error("Error sharing item");
    mockShare.mockRejectedValueOnce(cause);
    const err = await saveTextFile(FILE).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe(SAVE_FILE_FAILED_MESSAGE);
    expect((err as Error).cause).toBe(cause);
    expect(mockWarn).toHaveBeenCalledWith("save_file_share_failed", expect.any(Object));
    await flush();
    expect(mockDeleteFile).toHaveBeenCalledTimes(1);
  });

  it("treats a non-Error share rejection as a failure", async () => {
    mockShare.mockRejectedValueOnce("boom");
    await expect(saveTextFile(FILE)).rejects.toThrow(SAVE_FILE_FAILED_MESSAGE);
  });

  it("rejects without opening the sheet when the write fails", async () => {
    mockWriteFile.mockRejectedValueOnce(new Error("disk full"));
    await expect(saveTextFile(FILE)).rejects.toThrow(SAVE_FILE_FAILED_MESSAGE);

    expect(mockShare).not.toHaveBeenCalled();
    expect(mockDeleteFile).not.toHaveBeenCalled();
    expect(mockWarn).toHaveBeenCalledWith("save_file_write_failed", expect.any(Object));
  });

  it("rejects when the filesystem plugin is missing from the native build", async () => {
    failFsImport.value = true;
    await expect(saveTextFile(FILE)).rejects.toThrow(SAVE_FILE_FAILED_MESSAGE);
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("still resolves shared when deleting the cached copy fails, and logs it", async () => {
    mockDeleteFile.mockRejectedValueOnce(new Error("gone"));
    await expect(saveTextFile(FILE)).resolves.toBe("shared");
    await flush();
    expect(mockWarn).toHaveBeenCalledWith("save_file_cleanup_failed", expect.any(Object));
  });
});

describe("saveTextFile on web", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps the blob <a download> path and resolves downloaded", async () => {
    mockIsNativePlatform.mockReturnValue(false);
    vi.useFakeTimers();
    const createObjectURL = vi.fn().mockReturnValue("blob:export");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.href).toBe("blob:export");
      expect(this.download).toBe(FILE.filename);
      expect(this.rel).toBe("noopener");
      expect(this.isConnected).toBe(true);
    });

    await expect(saveTextFile(FILE)).resolves.toBe("downloaded");

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    await expect(blob.text()).resolves.toBe(FILE.text);
    expect(click).toHaveBeenCalledTimes(1);
    expect(document.querySelector("a[download]")).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:export");
    expect(mockWriteFile).not.toHaveBeenCalled();
    expect(mockShare).not.toHaveBeenCalled();
  });
});
