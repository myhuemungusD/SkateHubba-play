import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/storage ──────────────────── */

// Create a mock upload task that simulates uploadBytesResumable behavior
function createMockTask(_downloadUrl: string) {
  const task = {
    snapshot: { ref: "mock-ref" },
    on: vi.fn((_event: string, _progress: unknown, _error: unknown, complete: () => void) => {
      // Immediately call complete
      complete();
    }),
  };
  return task;
}

const { mockRef, mockUploadBytesResumable, mockGetDownloadURL, mockDeleteObject, mockListAll } = vi.hoisted(() => ({
  mockRef: vi.fn((_storage: unknown, path: string) => path),
  mockUploadBytesResumable: vi.fn(),
  mockGetDownloadURL: vi.fn().mockResolvedValue("https://cdn.example.com/video.webm"),
  mockDeleteObject: vi.fn().mockResolvedValue(undefined),
  mockListAll: vi.fn().mockResolvedValue({ items: [], prefixes: [] }),
}));

vi.mock("firebase/storage", () => ({
  ref: mockRef,
  uploadBytesResumable: mockUploadBytesResumable,
  getDownloadURL: mockGetDownloadURL,
  deleteObject: mockDeleteObject,
  listAll: mockListAll,
}));

vi.mock("../../firebase", () => ({
  // Storage upload now binds the file to the caller's UID via customMetadata
  // so storage.rules can enforce uploaderUid == request.auth.uid. Tests must
  // therefore expose a signed-in auth stub.
  requireAuth: () => ({ currentUser: { uid: "test-uid" } }),
  requireStorage: () => ({}),
}));

vi.mock("../analytics", () => ({
  trackEvent: vi.fn(),
  analytics: {
    videoUploaded: vi.fn(),
  },
}));

import { uploadVideo, deleteGameVideos, validateVideo } from "../storage";

/** Create a blob that passes the min-size (>1 KB) validation. */
function validBlob(type = "video/webm"): Blob {
  const blob = new Blob(["x"], { type });
  Object.defineProperty(blob, "size", { value: 2048 });
  return blob;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: mock task that completes immediately
  mockUploadBytesResumable.mockImplementation(() => createMockTask("https://cdn.example.com/video.webm"));
});

/* ── Tests ──────────────────────────────────── */

describe("storage service", () => {
  describe("uploadVideo", () => {
    it("uploads to the correct path and returns download URL", async () => {
      const blob = validBlob();
      const url = await uploadVideo("game1", 3, "set", blob);

      expect(mockRef).toHaveBeenCalledWith(expect.anything(), "games/game1/turn-3/set.webm");
      expect(mockUploadBytesResumable).toHaveBeenCalledWith(
        "games/game1/turn-3/set.webm",
        blob,
        expect.objectContaining({ contentType: "video/webm" }),
      );
      expect(url).toBe("https://cdn.example.com/video.webm");
    });

    it("sets correct custom metadata", async () => {
      const blob = validBlob();
      await uploadVideo("game1", 2, "match", blob);

      const metadata = mockUploadBytesResumable.mock.calls[0][2];
      expect(metadata.customMetadata.gameId).toBe("game1");
      expect(metadata.customMetadata.turn).toBe("2");
      expect(metadata.customMetadata.role).toBe("match");
      // uploaderUid binding is the security-critical metadata field — storage
      // rules reject create/update/delete unless this matches request.auth.uid.
      expect(metadata.customMetadata.uploaderUid).toBe("test-uid");
    });

    it("calls onProgress callback during upload", async () => {
      const progressFn = vi.fn();
      // Mock task that reports progress before completing
      mockUploadBytesResumable.mockImplementation(() => ({
        snapshot: { ref: "mock-ref" },
        on: vi.fn(
          (
            _event: string,
            onProgress: (s: { bytesTransferred: number; totalBytes: number }) => void,
            _error: unknown,
            complete: () => void,
          ) => {
            onProgress({ bytesTransferred: 50, totalBytes: 100 });
            onProgress({ bytesTransferred: 100, totalBytes: 100 });
            complete();
          },
        ),
      }));

      const blob = validBlob();
      await uploadVideo("game1", 1, "set", blob, progressFn);

      expect(progressFn).toHaveBeenCalledWith({ bytesTransferred: 50, totalBytes: 100, percent: 50 });
      expect(progressFn).toHaveBeenCalledWith({ bytesTransferred: 100, totalBytes: 100, percent: 100 });
    });

    it("retries on failure up to maxRetries", async () => {
      let callCount = 0;
      mockUploadBytesResumable.mockImplementation(() => ({
        snapshot: { ref: "mock-ref" },
        on: vi.fn((_event: string, _progress: unknown, onError: (err: Error) => void, complete: () => void) => {
          callCount++;
          if (callCount < 3) {
            onError(new Error("Network error"));
          } else {
            complete();
          }
        }),
      }));

      const blob = validBlob();
      const url = await uploadVideo("game1", 1, "set", blob, undefined, 2);

      expect(url).toBe("https://cdn.example.com/video.webm");
      expect(callCount).toBe(3);
    });

    it("reports 0 percent when totalBytes is 0", async () => {
      const progressFn = vi.fn();
      mockUploadBytesResumable.mockImplementation(() => ({
        snapshot: { ref: "mock-ref" },
        on: vi.fn(
          (
            _event: string,
            onProgress: (s: { bytesTransferred: number; totalBytes: number }) => void,
            _error: unknown,
            complete: () => void,
          ) => {
            onProgress({ bytesTransferred: 0, totalBytes: 0 });
            complete();
          },
        ),
      }));

      const blob = validBlob();
      await uploadVideo("game1", 1, "set", blob, progressFn);

      expect(progressFn).toHaveBeenCalledWith({ bytesTransferred: 0, totalBytes: 0, percent: 0 });
    });

    it("skips progress callback when not provided", async () => {
      mockUploadBytesResumable.mockImplementation(() => ({
        snapshot: { ref: "mock-ref" },
        on: vi.fn(
          (
            _event: string,
            onProgress: (s: { bytesTransferred: number; totalBytes: number }) => void,
            _error: unknown,
            complete: () => void,
          ) => {
            // Trigger the progress handler — it should not throw when no callback
            onProgress({ bytesTransferred: 50, totalBytes: 100 });
            complete();
          },
        ),
      }));

      const blob = validBlob();
      // No progress callback passed
      await expect(uploadVideo("game1", 1, "set", blob)).resolves.toBe("https://cdn.example.com/video.webm");
    });

    it("rejects when getDownloadURL fails after upload completes", async () => {
      mockGetDownloadURL.mockRejectedValueOnce(new Error("URL fetch failed"));
      const blob = validBlob();
      await expect(uploadVideo("game1", 1, "set", blob, undefined, 0)).rejects.toThrow("URL fetch failed");
    });

    it("throws after exhausting retries", async () => {
      mockUploadBytesResumable.mockImplementation(() => ({
        snapshot: { ref: "mock-ref" },
        on: vi.fn((_event: string, _progress: unknown, onError: (err: Error) => void) => {
          onError(new Error("Persistent failure"));
        }),
      }));

      const blob = validBlob();
      await expect(uploadVideo("game1", 1, "set", blob, undefined, 0)).rejects.toThrow("Persistent failure");
    });

    it("rejects upload when no signed-in user is available", async () => {
      // Re-mock the firebase module for this test only — currentUser undefined.
      vi.doMock("../../firebase", () => ({
        requireAuth: () => ({ currentUser: null }),
        requireStorage: () => ({}),
      }));
      vi.resetModules();
      const { uploadVideo: uploadVideoFresh } = await import("../storage");
      const blob = validBlob();
      await expect(uploadVideoFresh("game1", 1, "set", blob)).rejects.toThrow("must be signed in");
      vi.doUnmock("../../firebase");
      vi.resetModules();
    });

    it("rejects blobs that are too small (≤1 KB)", async () => {
      const tinyBlob = new Blob(["x"], { type: "video/webm" }); // ~1 byte
      await expect(uploadVideo("game1", 1, "set", tinyBlob)).rejects.toThrow("too small");
      expect(mockUploadBytesResumable).not.toHaveBeenCalled();
    });

    it("rejects blobs that exceed 50 MB", async () => {
      // Create a blob that reports size > 50MB via Object.defineProperty
      const bigBlob = new Blob(["x"], { type: "video/webm" });
      Object.defineProperty(bigBlob, "size", { value: 50 * 1024 * 1024 + 1 });
      await expect(uploadVideo("game1", 1, "set", bigBlob)).rejects.toThrow("50 MB limit");
      expect(mockUploadBytesResumable).not.toHaveBeenCalled();
    });

    it("uses .mp4 extension and content type for mp4 blobs", async () => {
      const blob = validBlob("video/mp4");
      const url = await uploadVideo("game1", 1, "set", blob);

      expect(mockRef).toHaveBeenCalledWith(expect.anything(), "games/game1/turn-1/set.mp4");
      expect(mockUploadBytesResumable).toHaveBeenCalledWith(
        "games/game1/turn-1/set.mp4",
        blob,
        expect.objectContaining({ contentType: "video/mp4" }),
      );
      expect(url).toBe("https://cdn.example.com/video.webm");
    });
  });

  describe("deleteGameVideos", () => {
    it("deletes all video files in a game's storage prefix", async () => {
      const item1 = { fullPath: "games/g1/turn-1/set.webm" };
      const item2 = { fullPath: "games/g1/turn-1/match.webm" };
      mockListAll
        .mockResolvedValueOnce({
          items: [],
          prefixes: ["games/g1/turn-1"],
        })
        .mockResolvedValueOnce({
          items: [item1, item2],
          prefixes: [],
        });
      mockDeleteObject.mockResolvedValue(undefined);

      const deleted = await deleteGameVideos("g1");

      expect(deleted).toBe(2);
      expect(mockDeleteObject).toHaveBeenCalledWith(item1);
      expect(mockDeleteObject).toHaveBeenCalledWith(item2);
    });

    it("returns 0 when no files exist", async () => {
      mockListAll.mockResolvedValueOnce({ items: [], prefixes: [] });

      const deleted = await deleteGameVideos("g1");

      expect(deleted).toBe(0);
      expect(mockDeleteObject).not.toHaveBeenCalled();
    });

    it("continues deleting other files when one delete fails", async () => {
      const item1 = { fullPath: "games/g1/turn-1/set.webm" };
      const item2 = { fullPath: "games/g1/turn-1/match.webm" };
      mockListAll
        .mockResolvedValueOnce({ items: [], prefixes: ["turn-1"] })
        .mockResolvedValueOnce({ items: [item1, item2], prefixes: [] });
      mockDeleteObject.mockRejectedValueOnce(new Error("permission denied")).mockResolvedValueOnce(undefined);

      const deleted = await deleteGameVideos("g1");

      expect(deleted).toBe(1);
    });

    it("handles listAll failure gracefully", async () => {
      mockListAll.mockRejectedValueOnce(new Error("not found"));

      const deleted = await deleteGameVideos("g1");

      expect(deleted).toBe(0);
    });

    it("handles non-Error rejection in delete", async () => {
      const item1 = { fullPath: "games/g1/turn-1/set.webm" };
      mockListAll.mockResolvedValueOnce({ items: [item1], prefixes: [] });
      mockDeleteObject.mockRejectedValueOnce("string error");

      const deleted = await deleteGameVideos("g1");
      expect(deleted).toBe(0);
    });

    it("handles non-Error rejection in listAll", async () => {
      mockListAll.mockRejectedValueOnce("string error");

      const deleted = await deleteGameVideos("g1");
      expect(deleted).toBe(0);
    });
  });

  describe("validateVideo", () => {
    it("rejects non-video MIME types", async () => {
      const blob = new Blob(["data"], { type: "text/plain" });
      const result = await validateVideo(blob);
      expect(result).toContain("Invalid video format");
    });

    it("rejects webm blob with wrong magic bytes", async () => {
      // Create a blob that claims to be webm but has wrong magic bytes
      const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const blob = new Blob([bytes], { type: "video/webm" });
      const result = await validateVideo(blob);
      expect(result).toContain("valid WebM");
    });

    it("rejects mp4 blob with wrong magic bytes", async () => {
      const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const blob = new Blob([bytes], { type: "video/mp4" });
      const result = await validateVideo(blob);
      expect(result).toContain("valid MP4");
    });

    it("accepts webm blob with correct magic bytes", async () => {
      // Prevent duration check from hanging in jsdom
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:test");
      URL.revokeObjectURL = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === "video") {
          setTimeout(() => {
            Object.defineProperty(el, "duration", { value: 5, writable: false });
            el.onloadedmetadata?.(new Event("loadedmetadata"));
          }, 0);
        }
        return el;
      });

      const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const blob = new Blob([bytes], { type: "video/webm" });
      const result = await validateVideo(blob);
      expect(result).toBeNull();

      URL.createObjectURL = origCreateObjectURL;
      vi.restoreAllMocks();
    });

    it("accepts mp4 blob with correct magic bytes", async () => {
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:test");
      URL.revokeObjectURL = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === "video") {
          setTimeout(() => {
            Object.defineProperty(el, "duration", { value: 5, writable: false });
            el.onloadedmetadata?.(new Event("loadedmetadata"));
          }, 0);
        }
        return el;
      });

      const bytes = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x66, 0x74, 0x79, 0x70, 0x00, 0x00, 0x00, 0x00]);
      const blob = new Blob([bytes], { type: "video/mp4" });
      const result = await validateVideo(blob);
      expect(result).toBeNull();

      URL.createObjectURL = origCreateObjectURL;
      vi.restoreAllMocks();
    });

    it("rejects video that is too short", async () => {
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:test");
      URL.revokeObjectURL = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === "video") {
          setTimeout(() => {
            Object.defineProperty(el, "duration", { value: 0.1, writable: false });
            el.onloadedmetadata?.(new Event("loadedmetadata"));
          }, 0);
        }
        return el;
      });

      const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const blob = new Blob([bytes], { type: "video/webm" });
      const result = await validateVideo(blob);
      expect(result).toContain("too short");

      URL.createObjectURL = origCreateObjectURL;
      vi.restoreAllMocks();
    });

    it("rejects video that is too long", async () => {
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:test");
      URL.revokeObjectURL = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === "video") {
          setTimeout(() => {
            Object.defineProperty(el, "duration", { value: 999, writable: false });
            el.onloadedmetadata?.(new Event("loadedmetadata"));
          }, 0);
        }
        return el;
      });

      const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const blob = new Blob([bytes], { type: "video/webm" });
      const result = await validateVideo(blob);
      expect(result).toContain("120-second limit");

      URL.createObjectURL = origCreateObjectURL;
      vi.restoreAllMocks();
    });

    it("handles non-finite video duration gracefully", async () => {
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:test");
      URL.revokeObjectURL = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === "video") {
          setTimeout(() => {
            Object.defineProperty(el, "duration", { value: Infinity, writable: false });
            el.onloadedmetadata?.(new Event("loadedmetadata"));
          }, 0);
        }
        return el;
      });

      const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const blob = new Blob([bytes], { type: "video/webm" });
      // Non-finite duration rejects internally but is caught — validation passes
      const result = await validateVideo(blob);
      expect(result).toBeNull();

      URL.createObjectURL = origCreateObjectURL;
      vi.restoreAllMocks();
    });

    it("handles video element error gracefully", async () => {
      const origCreateObjectURL = URL.createObjectURL;
      URL.createObjectURL = vi.fn(() => "blob:test");
      URL.revokeObjectURL = vi.fn();
      const origCreateElement = document.createElement.bind(document);
      vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
        const el = origCreateElement(tag);
        if (tag === "video") {
          setTimeout(() => {
            el.onerror?.(new Event("error"));
          }, 0);
        }
        return el;
      });

      const bytes = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const blob = new Blob([bytes], { type: "video/webm" });
      // Video element error is caught — validation passes (best-effort)
      const result = await validateVideo(blob);
      expect(result).toBeNull();

      URL.createObjectURL = origCreateObjectURL;
      vi.restoreAllMocks();
    });
  });
});
