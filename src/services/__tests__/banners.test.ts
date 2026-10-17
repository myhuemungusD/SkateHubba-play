import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  uploadBytes: vi.fn(),
  deleteObject: vi.fn(),
  getDownloadURL: vi.fn(),
  isAvatarSafe: vi.fn(),
  warn: vi.fn(),
  txGet: vi.fn(),
  txUpdate: vi.fn(),
  uid: { value: "u1" as string | null },
}));

vi.mock("firebase/storage", () => ({
  ref: (_s: unknown, path: string) => ({ path }),
  uploadBytes: h.uploadBytes,
  deleteObject: h.deleteObject,
  getDownloadURL: h.getDownloadURL,
}));
vi.mock("firebase/firestore", () => ({
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  runTransaction: async (_db: unknown, fn: (tx: unknown) => Promise<void>) => fn({ get: h.txGet, update: h.txUpdate }),
}));
vi.mock("../../firebase", () => ({
  requireAuth: () => ({ currentUser: h.uid.value === null ? null : { uid: h.uid.value } }),
  requireStorage: () => ({}),
  requireDb: () => ({}),
  ensureStorage: async () => ({}),
}));
vi.mock("../avatarModeration", () => ({ isAvatarSafe: h.isAvatarSafe }));
vi.mock("../logger", () => ({ logger: { warn: h.warn } }));

import {
  BannerError,
  computeBannerDimensions,
  deleteBannerObject,
  isPinnedBannerUrl,
  removeBanner,
  setBannerImageUrl,
  uploadBanner,
} from "../banners";

const BUCKET = "sk8hub-d7806.firebasestorage.app";
const GOOD_URL = `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/users%2Fu1%2Fbanner.webp?alt=media&token=t`;

function sized(bytes: number): Blob {
  const b = new Blob(["x"], { type: "image/webp" });
  Object.defineProperty(b, "size", { value: bytes });
  return b;
}

function patchImage(fail = false): void {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 3000;
    naturalHeight = 1000;
    set src(_v: string) {
      queueMicrotask(() => (fail ? this.onerror?.() : this.onload?.()));
    }
  }
  (globalThis as unknown as { Image: unknown }).Image = FakeImage;
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
}

function patchCanvas(outSize: number, ctxOk = true): void {
  const original = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag !== "canvas") return original(tag) as HTMLElement;
    return {
      getContext: () => (ctxOk ? { drawImage: () => {} } : null),
      toBlob: (cb: (b: Blob | null) => void) => cb(outSize < 0 ? null : sized(outSize)),
    } as unknown as HTMLElement;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  h.uid.value = "u1";
  vi.stubEnv("VITE_FIREBASE_STORAGE_BUCKET", BUCKET);
  patchImage();
  patchCanvas(50_000);
  h.isAvatarSafe.mockResolvedValue({ ok: true, score: 0.1 });
  h.deleteObject.mockResolvedValue(undefined);
  h.uploadBytes.mockResolvedValue({ ref: { path: "users/u1/banner.webp" } });
  h.getDownloadURL.mockResolvedValue(GOOD_URL);
  h.txGet.mockResolvedValue({ exists: () => true });
});

describe("computeBannerDimensions", () => {
  it("fits inside 1500x600 and never upscales", () => {
    expect(computeBannerDimensions(3000, 1000)).toEqual({ width: 1500, height: 500 });
    expect(computeBannerDimensions(1000, 2000)).toEqual({ width: 300, height: 600 });
    expect(computeBannerDimensions(800, 300)).toEqual({ width: 800, height: 300 });
  });
});

describe("isPinnedBannerUrl", () => {
  it("accepts only this bucket + uid banner", () => {
    expect(isPinnedBannerUrl("u1", GOOD_URL)).toBe(true);
    expect(isPinnedBannerUrl("u2", GOOD_URL)).toBe(false);
    expect(isPinnedBannerUrl("u1", "https://evil.example/banner.webp")).toBe(false);
  });
});

describe("uploadBanner", () => {
  it("uploads webp, then pins the URL on the profile", async () => {
    await expect(uploadBanner("u1", sized(5000))).resolves.toBe(GOOD_URL);
    expect(h.deleteObject).toHaveBeenCalled();
    expect(h.uploadBytes).toHaveBeenCalledWith(
      { path: "users/u1/banner.webp" },
      expect.anything(),
      expect.objectContaining({ contentType: "image/webp" }),
    );
    expect(h.txUpdate).toHaveBeenCalledWith("users/u1", { bannerImageUrl: GOOD_URL });
  });

  it("refuses when signed out or for another uid", async () => {
    h.uid.value = null;
    await expect(uploadBanner("u1", sized(5000))).rejects.toMatchObject({ code: "unauthenticated" });
    h.uid.value = "u2";
    await expect(uploadBanner("u1", sized(5000))).rejects.toBeInstanceOf(BannerError);
  });

  it("refuses unsafe and borderline pictures", async () => {
    h.isAvatarSafe.mockResolvedValueOnce({ ok: false, score: 0.95 });
    await expect(uploadBanner("u1", sized(5000))).rejects.toMatchObject({ code: "rejected" });
    h.isAvatarSafe.mockResolvedValueOnce({ ok: true, score: 0.6 });
    await expect(uploadBanner("u1", sized(5000))).rejects.toMatchObject({ code: "rejected" });
  });

  it("enforces the size bounds", async () => {
    patchCanvas(3 * 1024 * 1024);
    await expect(uploadBanner("u1", sized(5000))).rejects.toMatchObject({ code: "too_large" });
    patchCanvas(500);
    await expect(uploadBanner("u1", sized(5000))).rejects.toMatchObject({ code: "too_small" });
  });

  it("surfaces decode, context and encode failures", async () => {
    patchImage(true);
    await expect(uploadBanner("u1", sized(5000))).rejects.toThrow("banner_decode_failed");
    patchImage();
    patchCanvas(5000, false);
    await expect(uploadBanner("u1", sized(5000))).rejects.toThrow("banner_resize_unsupported");
    patchCanvas(-1);
    await expect(uploadBanner("u1", sized(5000))).rejects.toThrow("banner_encode_failed");
  });

  it("fails cleanly when the profile doc is missing", async () => {
    h.txGet.mockResolvedValueOnce({ exists: () => false });
    await expect(uploadBanner("u1", sized(5000))).rejects.toMatchObject({ code: "no_profile" });
  });
});

describe("setBannerImageUrl", () => {
  it("rejects an unpinned URL and allows clearing", async () => {
    await expect(setBannerImageUrl("u1", "https://evil.example/x.webp")).rejects.toThrow("banner_url_not_pinned");
    await setBannerImageUrl("u1", null);
    expect(h.txUpdate).toHaveBeenCalledWith("users/u1", { bannerImageUrl: null });
  });
});

describe("deleteBannerObject / removeBanner", () => {
  it("returns false quietly when nothing is there", async () => {
    h.deleteObject.mockRejectedValueOnce({ code: "storage/object-not-found" });
    await expect(deleteBannerObject("u1")).resolves.toBe(false);
    expect(h.warn).not.toHaveBeenCalled();
  });

  it("logs other failures (Error and non-Error)", async () => {
    h.deleteObject.mockRejectedValueOnce(new Error("boom"));
    await expect(deleteBannerObject("u1")).resolves.toBe(false);
    h.deleteObject.mockRejectedValueOnce("weird");
    await deleteBannerObject("u1");
    h.deleteObject.mockRejectedValueOnce(null);
    await deleteBannerObject("u1");
    expect(h.warn).toHaveBeenCalledWith("banner_delete_failed", { uid: "u1", error: "boom" });
    expect(h.warn).toHaveBeenCalledWith("banner_delete_failed", { uid: "u1", error: "weird" });
  });

  it("removeBanner deletes the object and clears the field", async () => {
    await removeBanner("u1");
    expect(h.deleteObject).toHaveBeenCalled();
    expect(h.txUpdate).toHaveBeenCalledWith("users/u1", { bannerImageUrl: null });
  });
});
