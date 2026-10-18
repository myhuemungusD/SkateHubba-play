import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../../../services/analytics", () => ({ trackEvent: vi.fn() }));
const bridge = vi.hoisted(() => ({
  isShareAvailable: vi.fn(),
  shareUrl: vi.fn(),
  copyText: vi.fn(),
}));
vi.mock("../../../services/nativeBridge", () => bridge);

import { useShareProfile } from "../useShareProfile";

beforeEach(() => vi.clearAllMocks());

describe("useShareProfile", () => {
  it("opens the share sheet with the public /player link", async () => {
    bridge.isShareAvailable.mockReturnValue(true);
    bridge.shareUrl.mockResolvedValue("native_share_text");
    const { result } = renderHook(() => useShareProfile("me", "jason"));
    await act(() => result.current.share());
    expect(bridge.shareUrl).toHaveBeenCalledWith(
      expect.objectContaining({ title: "@jason on SkateHubba", url: expect.stringMatching(/\/player\/me$/) }),
    );
    expect(result.current.copied).toBe(false);
  });

  it("copies the bare link when there is no share sheet, then clears the label", async () => {
    vi.useFakeTimers();
    bridge.isShareAvailable.mockReturnValue(false);
    bridge.copyText.mockResolvedValue(undefined);
    const { result } = renderHook(() => useShareProfile("me", "jason"));
    await act(() => result.current.share());
    expect(bridge.copyText).toHaveBeenCalledWith(expect.stringMatching(/\/player\/me$/));
    expect(result.current.copied).toBe(true);
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current.copied).toBe(false);
    vi.useRealTimers();
  });

  it("swallows a cancelled share", async () => {
    bridge.isShareAvailable.mockReturnValue(true);
    bridge.shareUrl.mockRejectedValue(new Error("cancel"));
    const { result } = renderHook(() => useShareProfile("me", "jason"));
    await act(() => result.current.share());
    expect(result.current.copied).toBe(false);
  });
});
