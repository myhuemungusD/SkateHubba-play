import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInit = vi.fn();
const mockCaptureException = vi.fn();
const mockCaptureMessage = vi.fn();
const mockAddBreadcrumb = vi.fn();

vi.mock("@sentry/react", () => ({
  init: mockInit,
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
  addBreadcrumb: mockAddBreadcrumb,
}));

beforeEach(() => vi.clearAllMocks());

describe("sentry lib", () => {
  it("initSentry loads the SDK and calls init", async () => {
    const { initSentry } = await import("../sentry");
    await initSentry({ dsn: "https://test@sentry.io/1" });
    expect(mockInit).toHaveBeenCalledWith({ dsn: "https://test@sentry.io/1" });
  });

  it("captureMessage delegates to SDK after init", async () => {
    const { initSentry, captureMessage } = await import("../sentry");
    await initSentry({ dsn: "https://test@sentry.io/1" });
    captureMessage("test message", "error");
    expect(mockCaptureMessage).toHaveBeenCalledWith("test message", "error");
  });
});
