import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchSpotName } from "../spots";

const mockWarn = vi.fn();

vi.mock("../logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: (...args: unknown[]) => mockWarn(...args),
    error: vi.fn(),
  },
}));

const VALID_ID = "11111111-2222-3333-4444-555555555555";

describe("fetchSpotName", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns the spot name on a successful response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: VALID_ID, name: "Hollenbeck Hubba" }),
    }) as unknown as typeof fetch;

    const result = await fetchSpotName(VALID_ID);
    expect(result).toBe("Hollenbeck Hubba");
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/spots/${VALID_ID}`,
      expect.objectContaining({ signal: undefined }),
    );
  });

  it("percent-encodes the id path segment", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "weird id", name: "Ledge" }),
    }) as unknown as typeof fetch;

    await fetchSpotName("weird id");
    expect(globalThis.fetch).toHaveBeenCalledWith(`/api/spots/weird%20id`, expect.any(Object));
  });

  it("returns null on a non-ok HTTP status without logging", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Spot not found" }),
    }) as unknown as typeof fetch;

    expect(await fetchSpotName(VALID_ID)).toBeNull();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("returns null when the response lacks a non-empty name", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: VALID_ID, name: "" }),
    }) as unknown as typeof fetch;

    expect(await fetchSpotName(VALID_ID)).toBeNull();
  });

  it("returns null when the response has no name field", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: VALID_ID }),
    }) as unknown as typeof fetch;

    expect(await fetchSpotName(VALID_ID)).toBeNull();
  });

  it("returns null and logs a warning on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    expect(await fetchSpotName(VALID_ID)).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith(
      "fetch_spot_name_failed",
      expect.objectContaining({ spotId: VALID_ID, error: "network down" }),
    );
  });

  it("returns null without logging on AbortError", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new DOMException("aborted", "AbortError")) as unknown as typeof fetch;

    expect(await fetchSpotName(VALID_ID)).toBeNull();
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it("logs 'unknown' when a non-Error is thrown", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue("string error") as unknown as typeof fetch;

    expect(await fetchSpotName(VALID_ID)).toBeNull();
    expect(mockWarn).toHaveBeenCalledWith("fetch_spot_name_failed", expect.objectContaining({ error: "unknown" }));
  });

  it("forwards a provided AbortSignal to fetch", async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: VALID_ID, name: "Ledge" }),
    }) as unknown as typeof fetch;

    await fetchSpotName(VALID_ID, controller.signal);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
