import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  DEFAULT_PROFILE_CUSTOM,
  type PinnableClip,
  type ProfileCustom,
  type ResolvedPins,
} from "../../../../../services/profileCustom";

const m = vi.hoisted(() => ({ get: vi.fn(), pinned: vi.fn() }));
vi.mock("../../../../../services/profileCustom", async (orig) => ({
  ...(await orig<typeof import("../../../../../services/profileCustom")>()),
  getProfileCustom: m.get,
  resolvePinnedClips: m.pinned,
}));

import { useProfileCustom } from "../useProfileCustom";

const tre: PinnableClip = { id: "c1", trickName: "Tre", videoUrl: "v.mp4", thumbnailUrl: null };

// Reset, not clear: a leftover mockResolvedValue must not answer the next test.
afterEach(() => vi.resetAllMocks());

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
    let finishOldPins: (p: ResolvedPins) => void = () => {};
    m.get.mockResolvedValueOnce({ ...DEFAULT_PROFILE_CUSTOM, pinnedClipIds: ["c1"] });
    m.pinned.mockReturnValueOnce(new Promise<ResolvedPins>((ok) => (finishOldPins = ok)));
    const { result, rerender } = renderHook(({ uid }) => useProfileCustom(uid, true), { initialProps: { uid: "u1" } });
    await vi.waitFor(() => expect(m.pinned).toHaveBeenCalledWith("u1", ["c1"]));
    const newer = { ...DEFAULT_PROFILE_CUSTOM, bio: "newer" };
    m.get.mockResolvedValueOnce(newer);
    rerender({ uid: "u2" });
    await vi.waitFor(() => expect(result.current.custom).toBe(newer));
    await act(async () => finishOldPins({ clips: [tre], keepIds: ["c1"] }));
    expect(result.current.pinned).toEqual([]);
  });

  it("clears pinned clips without a read when the saved doc pins none", async () => {
    m.get.mockResolvedValue({ ...DEFAULT_PROFILE_CUSTOM, pinnedClipIds: ["c1"] });
    m.pinned.mockResolvedValue({ clips: [tre], keepIds: ["c1"] });
    const { result } = renderHook(() => useProfileCustom("u1", true));
    await vi.waitFor(() => expect(result.current.pinned).toHaveLength(1));
    const next = { ...DEFAULT_PROFILE_CUSTOM, bio: "new" };
    await act(() => result.current.applySaved(next));
    expect(result.current.pinned).toEqual([]);
    expect(result.current.custom).toBe(next);
    expect(m.pinned).toHaveBeenCalledTimes(1);
  });

  it("drops orphaned pins from the loaded customization so the next save cleans them", async () => {
    const saved = { ...DEFAULT_PROFILE_CUSTOM, pinnedClipIds: ["g1", "c1", "g2"] };
    m.get.mockResolvedValueOnce(saved);
    m.pinned.mockResolvedValueOnce({ clips: [tre], keepIds: ["c1"] });
    const { result } = renderHook(() => useProfileCustom("u1", true));
    await vi.waitFor(() => expect(result.current.custom.pinnedClipIds).toEqual(["c1"]));
    expect(result.current.pinned).toEqual([tre]);
    expect(result.current.custom).toEqual({ ...saved, pinnedClipIds: ["c1"] });
    expect(m.pinned).toHaveBeenCalledWith("u1", ["g1", "c1", "g2"]);
  });

  it("keeps the same customization object when every pin is still good", async () => {
    const saved = { ...DEFAULT_PROFILE_CUSTOM, pinnedClipIds: ["c1"] };
    m.get.mockResolvedValueOnce(saved);
    m.pinned.mockResolvedValueOnce({ clips: [tre], keepIds: ["c1"] });
    const { result } = renderHook(() => useProfileCustom("u1", true));
    await vi.waitFor(() => expect(result.current.pinned).toEqual([tre]));
    expect(result.current.custom).toBe(saved);
  });

  it("prunes orphans from a just-saved customization too", async () => {
    m.get.mockResolvedValueOnce(DEFAULT_PROFILE_CUSTOM);
    const { result } = renderHook(() => useProfileCustom("u1", true));
    await vi.waitFor(() => expect(m.get).toHaveBeenCalled());
    m.pinned.mockResolvedValueOnce({ clips: [tre], keepIds: ["c1"] });
    await act(() => result.current.applySaved({ ...DEFAULT_PROFILE_CUSTOM, pinnedClipIds: ["gone", "c1"] }));
    expect(result.current.custom.pinnedClipIds).toEqual(["c1"]);
    expect(result.current.pinned).toEqual([tre]);
  });
});
