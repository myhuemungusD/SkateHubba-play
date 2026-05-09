import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Mock NSFWjs at the module boundary. The real package weighs ~10 MB
 * (TensorFlow.js + model weights) — under no circumstances should the
 * unit-test runner attempt to load the actual SDK.
 *
 * The source imports from `nsfwjs/core` + `nsfwjs/models/mobilenet_v2`
 * (rather than the `nsfwjs` default entrypoint) to keep the model bundle
 * lean — see `avatarModeration.ts` for the full rationale. The test mock
 * mirrors those subpaths exactly.
 */
const mockClassify = vi.fn();
const mockLoadModel = vi.fn();
const SENTINEL_MODEL_DEFINITION = { name: "MobileNetV2" };

vi.mock("nsfwjs/core", () => ({
  load: (...args: unknown[]) => mockLoadModel(...args),
}));

vi.mock("nsfwjs/models/mobilenet_v2", () => ({
  MobileNetV2Model: SENTINEL_MODEL_DEFINITION,
}));

import { isAvatarSafe, __resetAvatarModerationForTests } from "../avatarModeration";

const SAFE_PREDICTIONS = [
  { className: "Drawing", probability: 0.7 },
  { className: "Neutral", probability: 0.25 },
  { className: "Porn", probability: 0.05 },
];

const WARN_PREDICTIONS = [
  { className: "Sexy", probability: 0.7 },
  { className: "Neutral", probability: 0.3 },
];

const REJECT_PREDICTIONS = [
  { className: "Porn", probability: 0.95 },
  { className: "Neutral", probability: 0.05 },
];

function makeBlob(): Blob {
  // Tiny PNG signature is enough — the decode is mocked below.
  return new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
}

/**
 * jsdom's Image element doesn't fire `load` for blob: URLs synthesised by
 * createObjectURL — we patch the global so isAvatarSafe's decode step
 * resolves predictably.
 */
function patchImageDecode(success = true): void {
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_v: string) {
      queueMicrotask(() => {
        if (success) this.onload?.();
        else this.onerror?.();
      });
    }
  }
  (globalThis as unknown as { Image: typeof FakeImage }).Image = FakeImage;
  // jsdom's URL.createObjectURL exists but revokeObjectURL may be missing.
  if (!("createObjectURL" in URL)) {
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:mock";
  }
  if (!("revokeObjectURL" in URL)) {
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
  }
}

describe("avatarModeration service", () => {
  beforeEach(() => {
    mockLoadModel.mockReset();
    mockClassify.mockReset();
    __resetAvatarModerationForTests();
    patchImageDecode(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dynamically imports nsfwjs on first call and reuses the cached model", async () => {
    mockLoadModel.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockResolvedValue(SAFE_PREDICTIONS);

    await isAvatarSafe(makeBlob());
    await isAvatarSafe(makeBlob());

    // Model loads exactly once even across multiple calls.
    expect(mockLoadModel).toHaveBeenCalledTimes(1);
    expect(mockClassify).toHaveBeenCalledTimes(2);
  });

  it("registers only the MobileNetV2 model definition (bundle-size guard)", async () => {
    // Regression guard: switching back to the `nsfwjs` default entrypoint
    // would statically import all three model definitions and re-introduce
    // ~25 MB of unused weight shards into the production bundle. Pinning
    // the call signature here surfaces that regression on a green test
    // before it ships.
    mockLoadModel.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockResolvedValue(SAFE_PREDICTIONS);

    await isAvatarSafe(makeBlob());

    expect(mockLoadModel).toHaveBeenCalledWith("MobileNetV2", {
      modelDefinitions: [SENTINEL_MODEL_DEFINITION],
    });
  });

  it("rejects when the unsafe-class score is greater than 0.85", async () => {
    mockLoadModel.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockResolvedValue(REJECT_PREDICTIONS);

    const result = await isAvatarSafe(makeBlob());
    expect(result.ok).toBe(false);
    expect(result.score).toBeCloseTo(0.95);
    expect(result.category).toBe("Porn");
  });

  it("allows but populates category when score sits in the 0.5–0.85 warn band", async () => {
    mockLoadModel.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockResolvedValue(WARN_PREDICTIONS);

    const result = await isAvatarSafe(makeBlob());
    expect(result.ok).toBe(true);
    expect(result.score).toBeCloseTo(0.7);
    expect(result.category).toBe("Sexy");
  });

  it("allows silently when score is below 0.5", async () => {
    mockLoadModel.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockResolvedValue(SAFE_PREDICTIONS);

    const result = await isAvatarSafe(makeBlob());
    expect(result.ok).toBe(true);
    expect(result.score).toBeCloseTo(0.05);
    expect(result.category).toBeUndefined();
  });

  it("ignores classes that aren't on the unsafe list", async () => {
    mockLoadModel.mockResolvedValue({ classify: mockClassify });
    // A 0.99 Neutral score must NOT trip the reject threshold.
    mockClassify.mockResolvedValue([
      { className: "Neutral", probability: 0.99 },
      { className: "Porn", probability: 0.01 },
    ]);

    const result = await isAvatarSafe(makeBlob());
    expect(result.ok).toBe(true);
    expect(result.score).toBeCloseTo(0.01);
  });

  it("fails open with score: 0 when the model fails to load (network down)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockLoadModel.mockRejectedValue(new Error("network_down"));

    const result = await isAvatarSafe(makeBlob());
    expect(result).toEqual({ ok: true, score: 0 });
    expect(warnSpy).toHaveBeenCalledWith("[avatarModeration] model_load_failed", expect.any(Error));
  });

  it("retries the model load on a subsequent call after a load failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockLoadModel.mockRejectedValueOnce(new Error("network_down"));
    mockLoadModel.mockResolvedValueOnce({ classify: mockClassify });
    mockClassify.mockResolvedValue(SAFE_PREDICTIONS);

    const first = await isAvatarSafe(makeBlob());
    expect(first).toEqual({ ok: true, score: 0 });

    const second = await isAvatarSafe(makeBlob());
    expect(second.ok).toBe(true);
    expect(mockLoadModel).toHaveBeenCalledTimes(2);
  });

  it("fails open when the image decode rejects", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    patchImageDecode(false); // Image.onerror fires
    mockLoadModel.mockResolvedValue({ classify: mockClassify });

    const result = await isAvatarSafe(makeBlob());
    expect(result).toEqual({ ok: true, score: 0 });
    // classify should never be reached when decode fails.
    expect(mockClassify).not.toHaveBeenCalled();
  });

  it("fails open when classify itself throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    mockLoadModel.mockResolvedValue({ classify: mockClassify });
    mockClassify.mockRejectedValue(new Error("classify_boom"));

    const result = await isAvatarSafe(makeBlob());
    expect(result).toEqual({ ok: true, score: 0 });
  });
});
