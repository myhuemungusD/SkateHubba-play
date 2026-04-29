import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock at file scope so the eager `import("../mapbox")` at the top of the
// `isValidStyleUrl` block also gets the stub — otherwise that import would
// pull in the real lib/sentry and trigger an unmocked dynamic SDK load.
const mockCaptureMessage = vi.hoisted(() => vi.fn());
vi.mock("../sentry", () => ({
  captureMessage: mockCaptureMessage,
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { isValidStyleUrl, DEFAULT_MAP_STYLE } from "../mapbox";

describe("isValidStyleUrl", () => {
  it("accepts a Mapbox-hosted style URI (mapbox://styles/<owner>/<id>)", () => {
    expect(isValidStyleUrl("mapbox://styles/skatehubba/clxxxxxxxx")).toBe(true);
    expect(isValidStyleUrl(DEFAULT_MAP_STYLE)).toBe(true);
  });

  it("accepts an https URL pointing at self-hosted style JSON", () => {
    expect(isValidStyleUrl("https://example.com/style.json")).toBe(true);
  });

  it("rejects an http (non-TLS) URL — Mapbox GL will block mixed content", () => {
    expect(isValidStyleUrl("http://example.com/style.json")).toBe(false);
  });

  it("rejects mapbox:// URIs that are not under /styles/ (e.g. tilesets)", () => {
    expect(isValidStyleUrl("mapbox://mapbox.satellite")).toBe(false);
  });

  it("rejects malformed values that fail URL parsing", () => {
    expect(isValidStyleUrl("not a url")).toBe(false);
    expect(isValidStyleUrl("/relative/path")).toBe(false);
    expect(isValidStyleUrl("")).toBe(false);
  });
});

describe("MAP_STYLE module-level resolver", () => {
  beforeEach(() => {
    vi.resetModules();
    mockCaptureMessage.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("falls back to DEFAULT_MAP_STYLE when VITE_MAPBOX_STYLE_URL is unset", async () => {
    vi.stubEnv("VITE_MAPBOX_STYLE_URL", "");
    const { MAP_STYLE, DEFAULT_MAP_STYLE: defaultStyle } = await import("../mapbox");
    expect(MAP_STYLE).toBe(defaultStyle);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("uses the override when VITE_MAPBOX_STYLE_URL is a valid mapbox:// style", async () => {
    vi.stubEnv("VITE_MAPBOX_STYLE_URL", "mapbox://styles/skatehubba/abc123");
    const { MAP_STYLE } = await import("../mapbox");
    expect(MAP_STYLE).toBe("mapbox://styles/skatehubba/abc123");
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it("warns and reports to Sentry when VITE_MAPBOX_STYLE_URL is malformed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VITE_MAPBOX_STYLE_URL", "not-a-valid-url");
    const { MAP_STYLE, DEFAULT_MAP_STYLE: defaultStyle } = await import("../mapbox");
    expect(MAP_STYLE).toBe(defaultStyle);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("VITE_MAPBOX_STYLE_URL"));
    expect(mockCaptureMessage).toHaveBeenCalledWith("map_style_invalid", "warning");
  });
});
