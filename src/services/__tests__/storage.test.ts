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

const { mockRef, mockUploadBytesResumable, mockGetDownloadURL } = vi.hoisted(() => ({
  mockRef: vi.fn((_storage: unknown, path: string) => path),
  mockUploadBytesResumable: vi.fn(),
  mockGetDownloadURL: vi.fn().mockResolvedValue("https://cdn.example.com/video.webm"),
}));

vi.mock("firebase/storage", () => ({
  ref: mockRef,
  uploadBytesResumable: mockUploadBytesResumable,
  getDownloadURL: mockGetDownloadURL,
}));

vi.mock("../../firebase");

vi.mock("../analytics", () => ({
  trackEvent: vi.fn(),
  analytics: {
    videoUploaded: vi.fn(),
  },
}));

import { uploadVideo } from "../storage";

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
});
