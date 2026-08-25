import { describe, it, expect, vi, afterEach } from "vitest";
import { MAX_UPLOAD_BYTES, MIN_UPLOAD_BYTES } from "../../../constants/video";
import {
  ACCEPTED_VIDEO_MIME_TYPES,
  TRICK_NAME_MAX_LENGTH,
  VIDEO_ACCEPT_ATTR,
  probeVideoDuration,
  validateTrickName,
  validateVideoDuration,
  validateVideoFile,
} from "../validation";

describe("validateTrickName", () => {
  it("accepts a normal name", () => {
    expect(validateTrickName("Nollie heelflip")).toBeNull();
  });

  it("rejects empty and whitespace-only names", () => {
    expect(validateTrickName("")).toMatch(/name the trick/i);
    expect(validateTrickName("     ")).toMatch(/name the trick/i);
  });

  it("measures length against the TRIMMED name", () => {
    const atCap = "a".repeat(TRICK_NAME_MAX_LENGTH);
    expect(validateTrickName(`   ${atCap}   `)).toBeNull();
    expect(validateTrickName(`${atCap}b`)).toMatch(/80 characters or fewer/i);
  });
});

describe("validateVideoFile", () => {
  const ok = { type: "video/mp4", size: 5_000_000 };

  it("accepts both MIME types storage.rules allows", () => {
    for (const type of ACCEPTED_VIDEO_MIME_TYPES) {
      expect(validateVideoFile({ ...ok, type })).toBeNull();
    }
  });

  it("exposes those same types as the input's accept attribute", () => {
    expect(VIDEO_ACCEPT_ATTR).toBe("video/webm,video/mp4");
  });

  it("rejects other types, including ones an OS picker might sneak past `accept`", () => {
    expect(validateVideoFile({ ...ok, type: "video/quicktime" })).toMatch(/MP4 or WebM/i);
    expect(validateVideoFile({ ...ok, type: "image/png" })).toMatch(/MP4 or WebM/i);
    expect(validateVideoFile({ ...ok, type: "" })).toMatch(/MP4 or WebM/i);
  });

  it("enforces the size bounds EXCLUSIVELY, matching storage.rules", () => {
    expect(validateVideoFile({ ...ok, size: MIN_UPLOAD_BYTES })).toMatch(/empty or corrupted/i);
    expect(validateVideoFile({ ...ok, size: MIN_UPLOAD_BYTES + 1 })).toBeNull();
    expect(validateVideoFile({ ...ok, size: MAX_UPLOAD_BYTES })).toMatch(/too large/i);
    expect(validateVideoFile({ ...ok, size: MAX_UPLOAD_BYTES - 1 })).toBeNull();
  });
});

describe("validateVideoDuration", () => {
  it("accepts anything at or under the 30 s user-clip cap", () => {
    expect(validateVideoDuration(1)).toBeNull();
    expect(validateVideoDuration(30)).toBeNull();
  });

  it("tolerates sub-second overshoot from a recorder that stops 'at 30 seconds'", () => {
    expect(validateVideoDuration(30.4)).toBeNull();
  });

  it("rejects a genuinely longer clip", () => {
    expect(validateVideoDuration(31)).toMatch(/30 seconds or shorter/i);
  });

  it("treats an unreadable duration as a failure, not a pass", () => {
    // Streaming-muxed WebM genuinely reports Infinity — letting it through
    // would make the cap trivially bypassable.
    expect(validateVideoDuration(Infinity)).toMatch(/couldn't read/i);
    expect(validateVideoDuration(NaN)).toMatch(/couldn't read/i);
    expect(validateVideoDuration(0)).toMatch(/couldn't read/i);
    expect(validateVideoDuration(-5)).toMatch(/couldn't read/i);
  });
});

describe("probeVideoDuration", () => {
  const createObjectURL = vi.fn(() => "blob:stub");
  const revokeObjectURL = vi.fn();

  function stubUrls(): void {
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
  });

  /** Drive the detached <video> element the probe creates. */
  function interceptVideo(act: (el: HTMLVideoElement) => void): void {
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === "video") {
        // The probe assigns `src` last; react to that so the handlers are
        // already attached, exactly as a real browser would.
        Object.defineProperty(el, "src", {
          set() {
            queueMicrotask(() => act(el as HTMLVideoElement));
          },
          configurable: true,
        });
      }
      return el;
    });
  }

  it("resolves with the element's reported duration and revokes the object URL", async () => {
    stubUrls();
    interceptVideo((el) => {
      Object.defineProperty(el, "duration", { value: 12.5, configurable: true });
      el.onloadedmetadata?.(new Event("loadedmetadata"));
    });

    await expect(probeVideoDuration(new Blob(["x"]))).resolves.toBe(12.5);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stub");
  });

  it("rejects — and still revokes — when the browser cannot decode the file", async () => {
    stubUrls();
    interceptVideo((el) => {
      el.onerror?.(new Event("error"));
    });

    await expect(probeVideoDuration(new Blob(["x"]))).rejects.toThrow(/couldn't read/i);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stub");
  });
});
