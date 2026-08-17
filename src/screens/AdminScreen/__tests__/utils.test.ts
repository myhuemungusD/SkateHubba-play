import { describe, it, expect, vi, afterEach } from "vitest";
import { errorMessage, relativeAge } from "../utils";

afterEach(() => {
  vi.useRealTimers();
});

/** Freeze the clock so every relative-age assertion is deterministic. */
function at(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

describe("errorMessage", () => {
  it("passes an Error's message through", () => {
    expect(errorMessage(new Error("Missing or insufficient permissions."))).toBe(
      "Missing or insufficient permissions.",
    );
  });

  it("falls back for a non-Error throw", () => {
    expect(errorMessage("permission-denied")).toBe("Please try again.");
  });

  it("falls back for an Error with no message", () => {
    expect(errorMessage(new Error(""))).toBe("Please try again.");
  });

  it("accepts a caller-supplied fallback", () => {
    expect(errorMessage(null, "Couldn't load reports.")).toBe("Couldn't load reports.");
  });
});

describe("relativeAge", () => {
  it("labels a missing timestamp rather than inventing one", () => {
    expect(relativeAge(null)).toBe("unknown");
  });

  it("treats a clock-skewed future timestamp as just now", () => {
    at("2026-08-17T12:00:00Z");
    expect(relativeAge(new Date("2026-08-17T12:05:00Z"))).toBe("just now");
  });

  it("reports sub-minute ages as just now", () => {
    at("2026-08-17T12:00:00Z");
    expect(relativeAge(new Date("2026-08-17T11:59:30Z"))).toBe("just now");
  });

  it("reports minutes, hours and days", () => {
    at("2026-08-17T12:00:00Z");
    expect(relativeAge(new Date("2026-08-17T11:45:00Z"))).toBe("15m ago");
    expect(relativeAge(new Date("2026-08-17T09:00:00Z"))).toBe("3h ago");
    expect(relativeAge(new Date("2026-08-15T12:00:00Z"))).toBe("2d ago");
  });

  it("switches to a calendar date once a week has passed", () => {
    at("2026-08-17T12:00:00Z");
    expect(relativeAge(new Date("2026-08-01T12:00:00Z"))).toBe("Aug 1");
  });
});
