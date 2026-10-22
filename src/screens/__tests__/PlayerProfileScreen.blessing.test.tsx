import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import { fetchLineage } from "../../services/proBlessing";
import { viewerProfile, opponentProfile, buildBaseProps, fetchedState } from "./playerProfile.test-helpers";

/** "Bless as pro" shows only for a verified-pro viewer on a non-pro, flag on. */
vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: { profileViewed: vi.fn(), profileStatTileTapped: vi.fn() },
}));
vi.mock("../../services/blocking", () => ({ blockUser: vi.fn(), unblockUser: vi.fn() }));
vi.mock("../../services/achievements", () => ({ fetchAchievements: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/locker", () => ({ fetchLockerItems: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/spots", () => ({ listSpotsByCreator: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/proBlessing", () => ({
  BLESSING_REASON_MIN: 10,
  BLESSING_REASON_MAX: 280,
  blessSkater: vi.fn(),
  blessingErrorMessage: () => "",
  fetchLineage: vi.fn().mockResolvedValue([]),
}));
const fetchedProfile = vi.fn();
vi.mock("../../hooks/usePlayerProfile", () => ({
  usePlayerProfile: (...args: unknown[]) => fetchedProfile(...args),
}));

const props = buildBaseProps();
const proViewer = { ...viewerProfile, isVerifiedPro: true };

function openOpponent(
  profile: typeof opponentProfile = opponentProfile,
  viewer: typeof viewerProfile = proViewer,
): void {
  fetchedProfile.mockReturnValue(fetchedState({ profile }));
  render(<PlayerProfileScreen {...props} currentUserProfile={viewer} viewedUid="u2" isOwnProfile={false} />);
}

describe("PlayerProfileScreen — Bless as pro", () => {
  beforeEach(() => vi.stubEnv("VITE_FEATURE_PRO_BLESSING", "true"));
  afterEach(() => vi.unstubAllEnvs());

  it("shows for a verified pro viewing a non-pro", () => {
    openOpponent();
    expect(screen.getByTestId("bless-pro-button")).toBeInTheDocument();
  });

  it("is hidden for a non-pro viewer (pro can't be earned or self-served)", () => {
    openOpponent(opponentProfile, viewerProfile);
    expect(screen.queryByTestId("bless-pro-button")).not.toBeInTheDocument();
  });

  it("is hidden when the skater is already pro", () => {
    openOpponent({ ...opponentProfile, isVerifiedPro: true });
    expect(screen.queryByTestId("bless-pro-button")).not.toBeInTheDocument();
  });

  it("is hidden with the flag off", () => {
    vi.stubEnv("VITE_FEATURE_PRO_BLESSING", "");
    openOpponent();
    expect(screen.queryByTestId("bless-pro-button")).not.toBeInTheDocument();
  });

  it("drops the put-on-by line on a pro's profile with the flag off", () => {
    vi.stubEnv("VITE_FEATURE_PRO_BLESSING", "");
    vi.mocked(fetchLineage).mockClear();
    openOpponent({ ...opponentProfile, isVerifiedPro: true });
    expect(fetchLineage).not.toHaveBeenCalled();
    expect(screen.queryByTestId("blessed-by")).not.toBeInTheDocument();
  });

  it("loads the put-on-by line on a pro's profile with the flag on", () => {
    vi.stubEnv("VITE_FEATURE_PRO_BLESSING", "true");
    vi.mocked(fetchLineage).mockClear();
    openOpponent({ ...opponentProfile, isVerifiedPro: true });
    expect(fetchLineage).toHaveBeenCalledWith("u2");
  });
});
