import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetPlatform = vi.hoisted(() => vi.fn<() => string>(() => "web"));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => mockGetPlatform() } }));
vi.mock("firebase/firestore", () => ({ deleteField: () => "DELETE_FIELD" }));

import { currentPushPlatform, tagToken, untagAll, untagToken } from "../pushPlatform";

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
    expect(tagToken("abc:123")).toEqual({ platforms: { "abc:123": "ios" } });
  });

  it("removes one tag, or all of them", () => {
    expect(untagToken("abc")).toEqual({ platforms: { abc: "DELETE_FIELD" } });
    expect(untagAll()).toEqual({ platforms: "DELETE_FIELD" });
  });
});
