import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPlatform = vi.hoisted(() => vi.fn<() => string>(() => "web"));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => mockGetPlatform() } }));
vi.mock("firebase/firestore", () => ({ deleteField: () => "DELETE_FIELD" }));

import { currentPushPlatform, tagFromMirror, tagToken, untagAll, untagToken } from "../pushPlatform";

describe("pushPlatform", () => {
  beforeEach(() => mockGetPlatform.mockReset());

  it.each([
    ["ios", "ios"],
    ["android", "android"],
    ["web", "web"],
    ["electron", "web"],
  ])("Capacitor platform %s registers as %s", (capacitor, expected) => {
    mockGetPlatform.mockReturnValue(capacitor);
    expect(currentPushPlatform()).toBe(expected);
  });

  it("tags a token with this device's platform, keyed by the token", () => {
    mockGetPlatform.mockReturnValue("ios");
    expect(tagToken("abc:123", [])).toEqual({ platforms: { "abc:123": "ios" } });
  });

  it("drops tags for tokens no longer in the kept list", () => {
    mockGetPlatform.mockReturnValue("web");
    expect(tagToken("fresh", ["fresh", "still"], { stale: "ios", still: "android", gone: "web" })).toEqual({
      platforms: {
        fresh: "web",
        stale: "DELETE_FIELD",
        gone: "DELETE_FIELD",
      },
    });
  });

  it("tags from mirror data, tolerating a missing doc or malformed fields", () => {
    mockGetPlatform.mockReturnValue("android");
    expect(tagFromMirror("t", undefined)).toEqual({ platforms: { t: "android" } });
    expect(tagFromMirror("t", { tokens: "nope", platforms: ["x"] })).toEqual({ platforms: { t: "android" } });
    expect(tagFromMirror("t", { tokens: ["t", 7, "keep"], platforms: { keep: "web", old: "ios" } })).toEqual({
      platforms: { t: "android", old: "DELETE_FIELD" },
    });
  });

  it("removes one tag, or all of them", () => {
    expect(untagToken("abc")).toEqual({ platforms: { abc: "DELETE_FIELD" } });
    expect(untagAll()).toEqual({ platforms: "DELETE_FIELD" });
  });
});
