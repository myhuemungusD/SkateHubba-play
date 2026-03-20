import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock @capacitor/core ──────────────────── */

const { mockIsNativePlatform } = vi.hoisted(() => ({
  mockIsNativePlatform: vi.fn(() => false),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: mockIsNativePlatform },
}));

/* ── mock @capacitor/camera ────────────────── */

const { mockGetPhoto, mockCheckPermissions, mockRequestPermissions } = vi.hoisted(() => ({
  mockGetPhoto: vi.fn(),
  mockCheckPermissions: vi.fn(),
  mockRequestPermissions: vi.fn(),
}));

vi.mock("@capacitor/camera", () => ({
  Camera: {
    getPhoto: mockGetPhoto,
    checkPermissions: mockCheckPermissions,
    requestPermissions: mockRequestPermissions,
  },
  CameraResultType: { Uri: "uri" },
  CameraSource: { Camera: "CAMERA" },
}));

/* ── mock global fetch ─────────────────────── */

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { isNativePlatform, recordNativeVideo, checkNativeCameraPermissions } from "../nativeVideo";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsNativePlatform.mockReturnValue(false);
});

/* ── Tests ──────────────────────────────────── */

describe("nativeVideo service", () => {
  describe("isNativePlatform", () => {
    it("returns true when running in a Capacitor native shell", () => {
      mockIsNativePlatform.mockReturnValue(true);
      expect(isNativePlatform()).toBe(true);
    });

    it("returns false on the web", () => {
      mockIsNativePlatform.mockReturnValue(false);
      expect(isNativePlatform()).toBe(false);
    });
  });

  describe("recordNativeVideo", () => {
    it("captures video and returns blob with detected mime type", async () => {
      const fakeBlob = new Blob(["video-data"], { type: "video/mp4" });
      mockGetPhoto.mockResolvedValue({ webPath: "file:///tmp/video.mp4" });
      mockFetch.mockResolvedValue({ blob: () => Promise.resolve(fakeBlob) });

      const result = await recordNativeVideo();

      expect(mockGetPhoto).toHaveBeenCalledWith(
        expect.objectContaining({
          quality: 80,
          allowEditing: false,
          resultType: "uri",
          source: "CAMERA",
        }),
      );
      expect(mockFetch).toHaveBeenCalledWith("file:///tmp/video.mp4");
      expect(result.blob).toBe(fakeBlob);
      expect(result.mimeType).toBe("video/mp4");
    });

    it("falls back to video/mp4 when blob.type is empty", async () => {
      const fakeBlob = new Blob(["video-data"], { type: "" });
      mockGetPhoto.mockResolvedValue({ webPath: "file:///tmp/clip.mov" });
      mockFetch.mockResolvedValue({ blob: () => Promise.resolve(fakeBlob) });

      const result = await recordNativeVideo();

      expect(result.mimeType).toBe("video/mp4");
    });

    it("throws when webPath is missing", async () => {
      mockGetPhoto.mockResolvedValue({ webPath: undefined });

      await expect(recordNativeVideo()).rejects.toThrow("Native camera returned no file path");
    });

    it("propagates errors from Camera.getPhoto", async () => {
      mockGetPhoto.mockRejectedValue(new Error("User cancelled"));

      await expect(recordNativeVideo()).rejects.toThrow("User cancelled");
    });
  });

  describe("checkNativeCameraPermissions", () => {
    it("returns true on web without checking permissions", async () => {
      mockIsNativePlatform.mockReturnValue(false);

      const granted = await checkNativeCameraPermissions();

      expect(granted).toBe(true);
      expect(mockCheckPermissions).not.toHaveBeenCalled();
    });

    it("returns true when camera permission is already granted", async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockCheckPermissions.mockResolvedValue({ camera: "granted" });

      const granted = await checkNativeCameraPermissions();

      expect(granted).toBe(true);
      expect(mockRequestPermissions).not.toHaveBeenCalled();
    });

    it("requests permission and returns true when granted", async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockCheckPermissions.mockResolvedValue({ camera: "denied" });
      mockRequestPermissions.mockResolvedValue({ camera: "granted" });

      const granted = await checkNativeCameraPermissions();

      expect(granted).toBe(true);
      expect(mockRequestPermissions).toHaveBeenCalledWith({ permissions: ["camera"] });
    });

    it("requests permission and returns false when denied", async () => {
      mockIsNativePlatform.mockReturnValue(true);
      mockCheckPermissions.mockResolvedValue({ camera: "denied" });
      mockRequestPermissions.mockResolvedValue({ camera: "denied" });

      const granted = await checkNativeCameraPermissions();

      expect(granted).toBe(false);
    });
  });
});
