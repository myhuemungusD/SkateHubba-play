import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_PROFILE_CUSTOM, type ProfileCustom } from "../../../../../services/profileCustom";

const m = vi.hoisted(() => ({ get: vi.fn(), pinned: vi.fn() }));
vi.mock("../../../../../services/profileCustom", async (orig) => ({
  ...(await orig<typeof import("../../../../../services/profileCustom")>()),
  getProfileCustom: m.get,
  fetchPinnedClips: m.pinned,
}));

import { useProfileCustom } from "../useProfileCustom";

afterEach(() => vi.clearAllMocks());

describe("useProfileCustom", () => {
  it("drops a customization that loads after unmount", async () => {
    let finish: (c: ProfileCustom) => void = () => {};
    m.get.mockReturnValue(new Promise<ProfileCustom>((ok) => (finish = ok)));
    const { result, unmount } = renderHook(() => useProfileCustom("u1", true));
    unmount();
    await act(async () => finish({ ...DEFAULT_PROFILE_CUSTOM, pinnedClipIds: ["c1"] }));
    expect(m.pinned).not.toHaveBeenCalled();
    expect(result.current.custom).toBe(DEFAULT_PROFILE_CUSTOM);
  });

  it("clears pinned clips without a read when the saved doc pins none", async () => {
    m.get.mockResolvedValue({ ...DEFAULT_PROFILE_CUSTOM, pinnedClipIds: ["c1"] });
    m.pinned.mockResolvedValue([{ id: "c1", trickName: "Tre", videoUrl: "v.mp4", thumbnailUrl: null }]);
    const { result } = renderHook(() => useProfileCustom("u1", true));
    await vi.waitFor(() => expect(result.current.pinned).toHaveLength(1));
    const next = { ...DEFAULT_PROFILE_CUSTOM, bio: "new" };
    await act(() => result.current.applySaved(next));
    expect(result.current.pinned).toEqual([]);
    expect(result.current.custom).toBe(next);
    expect(m.pinned).toHaveBeenCalledTimes(1);
  });
});
