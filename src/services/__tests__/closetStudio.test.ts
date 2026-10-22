import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  signedIn: { uid: "u1" as string | null },
  isAvatarSafe: vi.fn(),
  warn: vi.fn(),
  storage: { uploadBytes: vi.fn(), deleteObject: vi.fn(), getDownloadURL: vi.fn() },
  fs: { setDoc: vi.fn(), deleteDoc: vi.fn(), getDocs: vi.fn() },
}));

vi.mock("firebase/storage", () => ({ ...h.storage, ref: (_bucket: unknown, path: string) => ({ path }) }));
vi.mock("firebase/firestore", () => ({
  ...h.fs,
  serverTimestamp: () => "TS",
  collection: (_db: unknown, ...segments: string[]) => segments.join("/"),
  doc: (_db: unknown, ...segments: string[]) => segments.join("/"),
}));
vi.mock("../../firebase", () => {
  const empty = () => ({});
  return {
    ensureStorage: async () => ({}),
    requireDb: empty,
    requireStorage: empty,
    requireAuth: () => ({ currentUser: h.signedIn.uid ? { uid: h.signedIn.uid } : null }),
  };
});
vi.mock("../logger", () => ({ logger: { warn: h.warn } }));
vi.mock("../avatarModeration", () => ({ isAvatarSafe: h.isAvatarSafe }));

import {
  ClosetDesignError,
  deleteDesign,
  deleteDesignObject,
  isDesignId,
  listMyDesigns,
  MAX_DESIGNS,
  nextDesignId,
  saveDesign,
} from "../closetStudio";

function sized(bytes: number): Blob {
  const b = new Blob(["x"], { type: "image/webp" });
  Object.defineProperty(b, "size", { value: bytes });
  return b;
}

const base = {
  id: "d0",
  name: " My Teeth ",
  slot: "shoes" as const,
  templateId: "mike_white_teeth_fire",
  layerCount: 3,
  image: sized(5000),
  share: false,
};

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return e instanceof ClosetDesignError ? e.code : String(e);
  }
}

describe("closetStudio service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.signedIn.uid = "u1";
    h.storage.uploadBytes.mockResolvedValue({ ref: { path: "r" } });
    h.storage.getDownloadURL.mockResolvedValue("https://x/closetDesigns%2Fu1%2Fd0.webp?t");
    h.storage.deleteObject.mockResolvedValue(undefined);
    h.isAvatarSafe.mockResolvedValue({ ok: true, score: 0.1 });
  });

  it("validates ids and finds the next free slot", () => {
    expect(isDesignId("d0")).toBe(true);
    expect(isDesignId("d23")).toBe(true);
    expect(isDesignId("d24")).toBe(false);
    expect(nextDesignId(["d0", "d2"])).toBe("d1");
    expect(nextDesignId(Array.from({ length: MAX_DESIGNS }, (_, i) => `d${i}`))).toBeNull();
  });

  it("saves a private design with the Mike White credit", async () => {
    const saved = await saveDesign("u1", base);
    expect(saved).toMatchObject({
      name: "My Teeth",
      credit: "Based on a Mike White design",
      shared: false,
      layerCount: 3,
    });
    expect(h.isAvatarSafe).not.toHaveBeenCalled();
    expect(h.storage.deleteObject).toHaveBeenCalledWith({ path: "closetDesigns/u1/d0.webp" });
    expect(h.storage.uploadBytes.mock.calls[0][2]).toEqual({
      contentType: "image/webp",
      customMetadata: { uploaderUid: "u1" },
    });
    expect(h.fs.setDoc).toHaveBeenCalledWith(
      "users/u1/closetDesigns/d0",
      expect.objectContaining({
        moderation: "pending",
        shared: false,
        credit: "Based on a Mike White design",
        updatedAt: "TS",
      }),
    );
  });

  it("runs the image filter before sharing and clamps layer count", async () => {
    const saved = await saveDesign("u1", { ...base, templateId: "", share: true, layerCount: 99 });
    expect(h.isAvatarSafe).toHaveBeenCalled();
    expect(saved.credit).toBe("");
    expect(saved.layerCount).toBe(8);
    expect(h.fs.setDoc.mock.calls[0][1]).toMatchObject({ moderation: "passed", shared: true });
  });

  it("refuses unsafe or borderline shares, bad input and other users", async () => {
    h.isAvatarSafe.mockResolvedValueOnce({ ok: false, score: 0.9 });
    expect(await code(saveDesign("u1", { ...base, share: true }))).toBe("rejected");
    h.isAvatarSafe.mockResolvedValueOnce({ ok: true, score: 0.6 });
    expect(await code(saveDesign("u1", { ...base, share: true }))).toBe("rejected");
    expect(await code(saveDesign("u1", { ...base, id: "x" }))).toBe("bad_id");
    expect(await code(saveDesign("u1", { ...base, name: "  " }))).toBe("bad_name");
    expect(await code(saveDesign("u1", { ...base, image: sized(2 * 1024 * 1024) }))).toBe("too_large");
    expect(await code(saveDesign("u1", { ...base, image: sized(10) }))).toBe("too_small");
    expect(await code(saveDesign("u2", base))).toBe("unauthenticated");
    h.signedIn.uid = null;
    expect(await code(saveDesign("u1", base))).toBe("unauthenticated");
    expect(h.storage.uploadBytes).not.toHaveBeenCalled();
  });

  it("lists valid designs in slot order", async () => {
    h.fs.getDocs.mockResolvedValue({
      docs: [
        { id: "d10", data: () => ({ name: "B", slot: "top", imageUrl: "u", layerCount: 2, shared: true }) },
        { id: "d2", data: () => ({ slot: "shoes", templateId: "mike_white_x", imageUrl: "u" }) },
        { id: "d3", data: () => ({ slot: "cape", imageUrl: "u" }) },
        { id: "d4", data: () => ({ slot: "shoes" }) },
      ],
    });
    const list = await listMyDesigns("u1");
    expect(list.map((d) => d.id)).toEqual(["d2", "d10"]);
    expect(list[0]).toMatchObject({
      name: "Untitled",
      layerCount: 1,
      shared: false,
      credit: "Based on a Mike White design",
    });
    expect(list[1]).toMatchObject({ name: "B", shared: true, credit: "" });
  });

  it("deletes objects best-effort and logs unexpected errors", async () => {
    h.storage.deleteObject.mockRejectedValueOnce({ code: "storage/object-not-found" });
    expect(await deleteDesignObject("u1", "d0")).toBe(false);
    expect(h.warn).not.toHaveBeenCalled();
    h.storage.deleteObject.mockRejectedValueOnce(new Error("boom"));
    expect(await deleteDesignObject("u1", "d0")).toBe(false);
    h.storage.deleteObject.mockRejectedValueOnce("weird");
    expect(await deleteDesignObject("u1", "d0")).toBe(false);
    h.storage.deleteObject.mockRejectedValueOnce(null);
    expect(await deleteDesignObject("u1", "d0")).toBe(false);
    expect(h.warn).toHaveBeenCalledTimes(3);
    expect(await deleteDesignObject("u1", "d0")).toBe(true);
  });

  it("deletes a design", async () => {
    await deleteDesign("u1", "d1");
    expect(h.fs.deleteDoc).toHaveBeenCalledWith("users/u1/closetDesigns/d1");
    expect(await code(deleteDesign("u2", "d1"))).toBe("unauthenticated");
  });
});
