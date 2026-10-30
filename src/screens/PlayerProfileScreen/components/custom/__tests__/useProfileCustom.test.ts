import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { DEFAULT_PROFILE_CUSTOM, type PinnableClip, type ProfileCustom } from "../../../../../services/profileCustom";

const m = vi.hoisted(() => ({ get: vi.fn(), pinned: vi.fn() }));
vi.mock("../../../../../services/profileCustom", async (orig) => ({
  ...(await orig<typeof import("../../../../../services/profileCustom")>()),
  getProfileCustom: m.get,
  fetchPinnedClips: m.pinned,
}));

import { useProfileCustom } from "../useProfileCustom";

afterEach(() => vi.clearAllMocks());

describe("useProfileCustom", () => {
  it("keeps the newer player's customization when an older one loads late", async () => {
    let finishOld: (c: ProfileCustom) => void = () => {};
    m.get.mockReturnValueOnce(new Promise<ProfileCustom>((ok) => (finishOld = ok)));
    const { result, rerender } = renderHook(({ uid }) => useProfileCustom(uid, true), { initialProps: { uid: "u1" } });
    const newer = { ...DEFAULT_PROFILE_CUSTOM, bio: "newer" };
    m.get.mockResolvedValueOnce(newer);
    rerender({ uid: "u2" });
    await vi.waitFor(() => expect(result.current.custom).toBe(newer));
    await act(async () => finishOld({ ...DEFAULT_PROFILE_CUSTOM, bio: "older", pinnedClipIds: ["c1"] }));
    expect(result.current.custom).toBe(newer);
    expect(m.pinned).not.toHaveBeenCalled();
  });

  it("keeps the newer player's empty pins when an older pinned read lands late", async () => {
    let finishOldPins: (c: PinnableClip[]) => void = () => {};
    m.get.mockResolvedValueOnce({ ...DEFAULT_PROFILE_CUSTOM, pinnedClipIds: ["c1"] });
    m.pinned.mockReturnValueOnce(new Promise<PinnableClip[]>((ok) => (finishOldPins = ok)));
    const { result, rerender } = renderHook(({ uid }) => useProfileCustom(uid, true), { initialProps: { uid: "u1" } });
    await vi.waitFor(() => expect(m.pinned).toHaveBeenCalledWith("u1", ["c1"]));
    const newer = { ...DEFAULT_PROFILE_CUSTOM, bio: "newer" };
    m.get.mockResolvedValueOnce(newer);
    rerender({ uid: "u2" });
    await vi.waitFor(() => expect(result.current.custom).toBe(newer));
    await act(async () => finishOldPins([{ id: "c1", trickName: "Tre", videoUrl: "v.mp4", thumbnailUrl: null }]));
    expect(result.current.pinned).toEqual([]);
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
