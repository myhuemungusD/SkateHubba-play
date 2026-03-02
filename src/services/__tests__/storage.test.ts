import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/storage ──────────────────── */
const { mockRef, mockUploadBytes, mockGetDownloadURL } = vi.hoisted(() => ({
  mockRef: vi.fn((...args: any[]) => args[1]),
  mockUploadBytes: vi.fn().mockResolvedValue({}),
  mockGetDownloadURL: vi.fn().mockResolvedValue("https://cdn.example.com/video.webm"),
}));

vi.mock("firebase/storage", () => ({
  ref: mockRef,
  uploadBytes: mockUploadBytes,
  getDownloadURL: mockGetDownloadURL,
}));

vi.mock("../../firebase");

import { uploadVideo } from "../storage";

beforeEach(() => vi.clearAllMocks());

/* ── Tests ──────────────────────────────────── */

describe("storage service", () => {
  describe("uploadVideo", () => {
    it("uploads to the correct path and returns download URL", async () => {
      const blob = new Blob(["video"], { type: "video/webm" });
      const url = await uploadVideo("game1", 3, "set", blob);

      expect(mockRef).toHaveBeenCalledWith(
        expect.anything(),
        "games/game1/turn-3/set.webm"
      );
      expect(mockUploadBytes).toHaveBeenCalledWith(
        "games/game1/turn-3/set.webm",
        blob,
        expect.objectContaining({ contentType: "video/webm" })
      );
      expect(url).toBe("https://cdn.example.com/video.webm");
    });

    it("sets correct custom metadata", async () => {
      const blob = new Blob(["video"], { type: "video/webm" });
      await uploadVideo("game1", 2, "match", blob);

      const metadata = mockUploadBytes.mock.calls[0][2];
      expect(metadata.customMetadata.gameId).toBe("game1");
      expect(metadata.customMetadata.turn).toBe("2");
      expect(metadata.customMetadata.role).toBe("match");
    });
  });
});
