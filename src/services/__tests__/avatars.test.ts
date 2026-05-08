import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for the avatar service.
 *
 * - The Firebase storage SDK is mocked at the module boundary so we can
 *   exercise the upload pipeline without touching a real bucket.
 * - `isAvatarSafe` from avatarModeration is mocked too — its own test
 *   suite owns the moderation contract.
 * - The canvas-based resize is exercised indirectly via `computeResizeDimensions`
 *   (pure math) and a stubbed Canvas API; jsdom's canvas is non-functional,
 *   so we replace the methods we touch.
 */

const { mockUploadBytes, mockDeleteObject, mockGetDownloadURL, mockRef, mockIsAvatarSafe, currentUserUidRef } =
  vi.hoisted(() => ({
    mockUploadBytes: vi.fn(),
    mockDeleteObject: vi.fn(),
    mockGetDownloadURL: vi.fn(),
    mockRef: vi.fn((_storage: unknown, path: string) => ({ path })),
    mockIsAvatarSafe: vi.fn(),
    // Mutable holder so individual tests can swap in a mismatching auth uid.
    currentUserUidRef: { value: "user-1" as string | null },
  }));

vi.mock("firebase/storage", () => ({
  ref: mockRef,
  uploadBytes: mockUploadBytes,
  deleteObject: mockDeleteObject,
  getDownloadURL: mockGetDownloadURL,
}));

vi.mock("../../firebase", () => ({
  requireAuth: () => ({
    currentUser: currentUserUidRef.value === null ? null : { uid: currentUserUidRef.value },
  }),
  requireStorage: () => ({}),
}));

vi.mock("../avatarModeration", () => ({
  isAvatarSafe: mockIsAvatarSafe,
}));

import {
  AvatarBorderlineError,
  AvatarRejectedError,
  AvatarTooLargeError,
  AvatarTooSmallError,
  computeResizeDimensions,
  deleteAvatar,
  getAvatarFallbackUrl,
  uploadAvatar,
} from "../avatars";

/**
 * Build a Blob whose `.size` reports `bytes`. Used to exercise the
 * size-validation branches without actually allocating a 2 MB buffer.
 */
function makeSizedBlob(bytes: number, type = "image/webp"): Blob {
  const blob = new Blob(["x"], { type });
  Object.defineProperty(blob, "size", { value: bytes });
  return blob;
}

/**
 * Patch `URL.createObjectURL` + `Image` so the resize pipeline's decode
 * step resolves with a stubbed image of the requested dimensions.
 */
function patchImage(naturalWidth: number, naturalHeight: number): void {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = naturalWidth;
    naturalHeight = naturalHeight;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  (globalThis as unknown as { Image: typeof FakeImage }).Image = FakeImage;
  if (!("createObjectURL" in URL)) {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:mock";
  }
  if (!("revokeObjectURL" in URL)) {
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  }
}

/**
 * Patch `document.createElement('canvas')` so toBlob synthesises a blob
 * of the configured size — the real canvas is unimplemented in jsdom.
 */
function patchCanvas(outputSize: number, contextOk = true): void {
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return original(tag) as HTMLElement;
    return {
      width: 0,
      height: 0,
      getContext: () => (contextOk ? { drawImage: () => {} } : null),
      toBlob: (cb: (b: Blob | null) => void) => {
        if (outputSize < 0) return cb(null);
        cb(makeSizedBlob(outputSize, "image/webp"));
      },
    } as unknown as HTMLElement;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUploadBytes.mockResolvedValue({ ref: { fullPath: "users/user-1/avatar.webp" } });
  mockDeleteObject.mockResolvedValue(undefined);
  mockGetDownloadURL.mockResolvedValue("https://download.example/avatar.webp");
  mockIsAvatarSafe.mockResolvedValue({ ok: true, score: 0.1 });
  patchImage(800, 600);
  patchCanvas(50_000);
});

describe("computeResizeDimensions", () => {
  it("returns the original dims when both sides are within the cap", () => {
    expect(computeResizeDimensions(300, 300)).toEqual({ width: 300, height: 300 });
  });
  it("scales a landscape source on width", () => {
    expect(computeResizeDimensions(800, 600)).toEqual({ width: 400, height: 300 });
  });
  it("scales a portrait source on height", () => {
    expect(computeResizeDimensions(600, 800)).toEqual({ width: 300, height: 400 });
  });
  it("returns a square at the cap when the source is square and oversized", () => {
    expect(computeResizeDimensions(2000, 2000)).toEqual({ width: 400, height: 400 });
  });
  it("respects an explicit max-dimension override", () => {
    expect(computeResizeDimensions(1000, 1000, 200)).toEqual({ width: 200, height: 200 });
  });
});

describe("uploadAvatar", () => {
  it("uploads to users/{uid}/avatar.webp and returns the download URL", async () => {
    const url = await uploadAvatar("user-1", makeSizedBlob(40_000, "image/jpeg"));
    expect(mockRef).toHaveBeenCalledWith(expect.anything(), "users/user-1/avatar.webp");
    expect(mockUploadBytes).toHaveBeenCalledWith(
      expect.objectContaining({ path: "users/user-1/avatar.webp" }),
      expect.any(Blob),
      expect.objectContaining({
        contentType: "image/webp",
        customMetadata: expect.objectContaining({ uploaderUid: "user-1" }),
      }),
    );
    expect(url).toBe("https://download.example/avatar.webp");
  });

  it("rejects when NSFW score > 0.85", async () => {
    mockIsAvatarSafe.mockResolvedValue({ ok: false, score: 0.92, category: "Porn" });
    await expect(uploadAvatar("user-1", makeSizedBlob(40_000))).rejects.toBeInstanceOf(AvatarRejectedError);
    expect(mockUploadBytes).not.toHaveBeenCalled();
  });

  it("returns a borderline error for scores in 0.5..0.85 unless caller accepts", async () => {
    mockIsAvatarSafe.mockResolvedValue({ ok: true, score: 0.7, category: "Sexy" });
    await expect(uploadAvatar("user-1", makeSizedBlob(40_000))).rejects.toBeInstanceOf(AvatarBorderlineError);
    expect(mockUploadBytes).not.toHaveBeenCalled();
  });

  it("uploads when borderline + acceptBorderlineNsfw passed", async () => {
    mockIsAvatarSafe.mockResolvedValue({ ok: true, score: 0.7, category: "Sexy" });
    const url = await uploadAvatar("user-1", makeSizedBlob(40_000), { acceptBorderlineNsfw: true });
    expect(url).toBe("https://download.example/avatar.webp");
    expect(mockUploadBytes).toHaveBeenCalled();
  });

  it("rejects when the resized blob exceeds 2 MB", async () => {
    patchCanvas(3 * 1024 * 1024);
    await expect(uploadAvatar("user-1", makeSizedBlob(8_000_000))).rejects.toBeInstanceOf(AvatarTooLargeError);
  });

  it("rejects when the resized blob is at or below 1 KB", async () => {
    patchCanvas(500);
    await expect(uploadAvatar("user-1", makeSizedBlob(40_000))).rejects.toBeInstanceOf(AvatarTooSmallError);
  });

  it("logs but does not fail when the pre-upload delete returns a non-not-found error", async () => {
    mockDeleteObject.mockRejectedValueOnce(Object.assign(new Error("perm"), { code: "storage/unauthorized" }));
    const url = await uploadAvatar("user-1", makeSizedBlob(40_000));
    expect(url).toBe("https://download.example/avatar.webp");
  });

  it("tolerates a non-Error rejection from the pre-upload delete (defensive coercion)", async () => {
    // Some Firebase SDK paths reject with plain strings — exercise the
    // String(err) branch in the catch body.
    mockDeleteObject.mockRejectedValueOnce("opaque-failure");
    const url = await uploadAvatar("user-1", makeSizedBlob(40_000));
    expect(url).toBe("https://download.example/avatar.webp");
  });

  it("tolerates a non-Error rejection without a `code` field on pre-upload delete", async () => {
    mockDeleteObject.mockRejectedValueOnce({ message: "no-code" });
    const url = await uploadAvatar("user-1", makeSizedBlob(40_000));
    expect(url).toBe("https://download.example/avatar.webp");
  });

  it("silently swallows the pre-upload delete when the object is not found", async () => {
    mockDeleteObject.mockRejectedValueOnce(Object.assign(new Error("nf"), { code: "storage/object-not-found" }));
    const url = await uploadAvatar("user-1", makeSizedBlob(40_000));
    expect(url).toBe("https://download.example/avatar.webp");
  });

  it("throws when the auth currentUser is null", async () => {
    currentUserUidRef.value = null;
    try {
      await expect(uploadAvatar("user-1", makeSizedBlob(40_000))).rejects.toThrow("avatar_upload_unauthenticated");
    } finally {
      currentUserUidRef.value = "user-1";
    }
  });

  it("throws when the calling auth uid does not match the upload target", async () => {
    currentUserUidRef.value = "other-user";
    try {
      await expect(uploadAvatar("user-1", makeSizedBlob(40_000))).rejects.toThrow("avatar_upload_unauthenticated");
    } finally {
      currentUserUidRef.value = "user-1";
    }
  });

  it("rethrows when the canvas context is unsupported", async () => {
    patchCanvas(50_000, false);
    await expect(uploadAvatar("user-1", makeSizedBlob(40_000))).rejects.toThrow("avatar_resize_unsupported");
  });

  it("rethrows when the canvas encode fails", async () => {
    patchCanvas(-1);
    await expect(uploadAvatar("user-1", makeSizedBlob(40_000))).rejects.toThrow("avatar_encode_failed");
  });

  it("rethrows when the source decode fails", async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      set src(_v: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    (globalThis as unknown as { Image: typeof FailingImage }).Image = FailingImage;
    await expect(uploadAvatar("user-1", makeSizedBlob(40_000))).rejects.toThrow("avatar_decode_failed");
  });
});

describe("deleteAvatar", () => {
  it("attempts to delete all three extension variants", async () => {
    await deleteAvatar("user-1");
    expect(mockDeleteObject).toHaveBeenCalledTimes(3);
    expect(mockRef).toHaveBeenCalledWith(expect.anything(), "users/user-1/avatar.webp");
    expect(mockRef).toHaveBeenCalledWith(expect.anything(), "users/user-1/avatar.jpeg");
    expect(mockRef).toHaveBeenCalledWith(expect.anything(), "users/user-1/avatar.png");
  });

  it("tolerates not-found on every variant", async () => {
    mockDeleteObject.mockRejectedValue(Object.assign(new Error("nf"), { code: "storage/object-not-found" }));
    await expect(deleteAvatar("user-1")).resolves.toBeUndefined();
  });

  it("logs a warning on non-not-found errors but does not throw", async () => {
    mockDeleteObject.mockRejectedValue(Object.assign(new Error("perm"), { code: "storage/unauthorized" }));
    await expect(deleteAvatar("user-1")).resolves.toBeUndefined();
  });

  it("tolerates non-Error rejections per variant (defensive coercion)", async () => {
    // Mix of code-less + non-Error rejections to exercise both `?? ""` and
    // `String(err)` branches.
    mockDeleteObject
      .mockRejectedValueOnce("opaque")
      .mockRejectedValueOnce({ message: "no-code" })
      .mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "storage/unauthorized" }));
    await expect(deleteAvatar("user-1")).resolves.toBeUndefined();
  });
});

describe("getAvatarFallbackUrl", () => {
  it("returns the static SVG path", () => {
    expect(getAvatarFallbackUrl()).toBe("/default-skater.svg");
  });
});
