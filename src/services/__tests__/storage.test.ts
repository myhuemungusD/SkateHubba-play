import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── mock firebase/storage ──────────────────── */
const mockRef = vi.fn((...args: any[]) => args[1]);
const mockUploadBytes = vi.fn().mockResolvedValue({});
const mockGetDownloadURL = vi.fn().mockResolvedValue("https://cdn.example.com/video.webm");

vi.mock("firebase/storage", () => ({
  ref: (...args: any[]) => mockRef(...args),
  uploadBytes: (...args: any[]) => mockUploadBytes(...args),
  getDownloadURL: (...args: any[]) => mockGetDownloadURL(...args),
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
