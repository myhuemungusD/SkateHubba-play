import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useInitialClip } from "../useInitialClip";

afterEach(() => vi.unstubAllGlobals());

describe("useInitialClip", () => {
  it("does nothing without a clip", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useInitialClip(undefined, vi.fn(), vi.fn()));
    expect(result.current).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads once and stages the clip with its trick name", async () => {
    const blob = new Blob(["x"], { type: "video/mp4" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    vi.stubGlobal("fetch", fetchMock);
    const stage = vi.fn();
    const setName = vi.fn();
    const clip = { videoUrl: "https://v/1.mp4", trickName: "Kickflip" };
    const { rerender } = renderHook(() => useInitialClip(clip, stage, setName));
    await waitFor(() => expect(stage).toHaveBeenCalledWith(blob));
    expect(setName).toHaveBeenCalledWith("Kickflip");
    rerender();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an error when the download fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    const stage = vi.fn();
    const { result } = renderHook(() => useInitialClip({ videoUrl: "u", trickName: "t" }, stage, vi.fn()));
    await waitFor(() => expect(result.current).toMatch(/Couldn't load that clip/));
    expect(stage).not.toHaveBeenCalled();
  });
});
