import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { GameDoc } from "../../../services/games";
import type { LockerItem } from "../../../services/locker";
import type { UserProfile } from "../../../services/users";
import { buildCompletedGame, opponentProfile, viewerProfile } from "../../__tests__/playerProfile.test-helpers";

const m = vi.hoisted(() => ({
  usePlayerProfile: vi.fn(),
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
  fetchLockerItems: vi.fn(),
}));

vi.mock("../../../hooks/usePlayerProfile", () => ({ usePlayerProfile: m.usePlayerProfile }));
vi.mock("../../../services/blocking", () => ({ blockUser: m.blockUser, unblockUser: m.unblockUser }));
vi.mock("../../../services/achievements", () => ({ fetchAchievements: async () => [] }));
vi.mock("../../../services/locker", () => ({ fetchLockerItems: m.fetchLockerItems }));

import { usePlayerProfileController } from "../usePlayerProfileController";

const noGames: GameDoc[] = [];

beforeEach(() => {
  m.usePlayerProfile.mockReturnValue({ profile: opponentProfile, games: [], loading: false, error: null });
  m.blockUser.mockResolvedValue(undefined);
  m.unblockUser.mockResolvedValue(undefined);
  m.fetchLockerItems.mockResolvedValue([]);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("usePlayerProfileController edges", () => {
  it("has no profile on the own-profile view while the viewer's doc is still missing", () => {
    const { result } = renderHook(() =>
      usePlayerProfileController({ viewedUid: "me", currentUserProfile: null, ownGames: noGames, isOwnProfile: true }),
    );
    expect(result.current.profile).toBeNull();
    expect(result.current.opponents).toEqual([]);
    expect(result.current.stats.vsYouTotal).toBe(0);
  });

  it("sorts games with no updatedAt clock after timed ones", () => {
    const timed = buildCompletedGame({ id: "timed", updatedAt: { toMillis: () => 5 } as GameDoc["updatedAt"] });
    const untimed = buildCompletedGame({ id: "untimed", updatedAt: null as unknown as GameDoc["updatedAt"] });
    const plain = buildCompletedGame({ id: "plain", updatedAt: {} as GameDoc["updatedAt"] });
    const { result } = renderHook(() =>
      usePlayerProfileController({
        viewedUid: "me",
        currentUserProfile: viewerProfile,
        ownGames: [untimed, timed, plain],
        isOwnProfile: true,
      }),
    );
    expect(result.current.completedGames.map((g) => g.id)[0]).toBe("timed");
    expect(result.current.completedGames).toHaveLength(3);
  });

  it("lists opponents by games played, most first", () => {
    const vs = (id: string, opp: string, winner: string) =>
      buildCompletedGame({ id, player2Uid: opp, player2Username: opp, winner });
    const { result } = renderHook(() =>
      usePlayerProfileController({
        viewedUid: "me",
        currentUserProfile: viewerProfile,
        ownGames: [vs("a", "once", "me"), vs("b", "twice", "me"), vs("c", "twice", "twice")],
        isOwnProfile: true,
      }),
    );
    expect(result.current.opponents.map((o) => [o.uid, o.totalGames, o.wins, o.losses])).toEqual([
      ["twice", 2, 1, 1],
      ["once", 1, 1, 0],
    ]);
  });

  it("does not write a block or unblock for a signed-out visitor", async () => {
    const { result } = renderHook(() =>
      usePlayerProfileController({ viewedUid: "u2", currentUserProfile: null, ownGames: noGames, isOwnProfile: false }),
    );
    expect(result.current.profile?.uid).toBe("u2");
    await act(() => result.current.confirmBlock());
    await act(() => result.current.handleUnblock());
    expect(m.blockUser).not.toHaveBeenCalled();
    expect(m.unblockUser).not.toHaveBeenCalled();
    expect(result.current.blockLoading).toBe(false);
  });

  it("ranks unknown rarities below every known one in the pinned shelf", async () => {
    vi.stubEnv("VITE_FEATURE_CLOSET_ENABLED", "true");
    const item = (id: string, rarity: string) => ({ id, rarity, equipped: false }) as unknown as LockerItem;
    m.fetchLockerItems.mockResolvedValue([
      item("mystery", "prototype"),
      item("c", "common"),
      item("odd", "sample"),
      item("g", "grail"),
    ]);
    const viewer: UserProfile = viewerProfile;
    const { result } = renderHook(() =>
      usePlayerProfileController({
        viewedUid: "u2",
        currentUserProfile: viewer,
        ownGames: noGames,
        isOwnProfile: false,
      }),
    );
    await waitFor(() => expect(result.current.lockerItems).toHaveLength(4));
    expect(result.current.pinnedItems.map((i) => i.id)).toEqual(["g", "c", "mystery", "odd"]);
  });
});
