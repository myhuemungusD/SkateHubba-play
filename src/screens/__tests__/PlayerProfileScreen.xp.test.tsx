import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import { buildBaseProps, fetchedState, opponentProfile, viewerProfile } from "./playerProfile.test-helpers";
import type { FetchedProfileState } from "./playerProfile.test-helpers";

/**
 * The profile XP surfaces (level chip, "L1 · 0 / 24 XP" progress line, the
 * achievements ribbon) are gated on isXpEnabled() alone: no platform check,
 * so a local Xcode archive and the CI build behave the same for the same
 * VITE_FEATURE_XP_ENABLED value. Covered at screen level for both the
 * viewer's own page and another player's page, in both flag states.
 */

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: { profileViewed: vi.fn(), profileStatTileTapped: vi.fn() },
}));
vi.mock("../../services/blocking", () => ({ blockUser: vi.fn(), unblockUser: vi.fn() }));
vi.mock("../../services/achievements", () => ({ fetchAchievements: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/locker", () => ({ fetchLockerItems: vi.fn().mockResolvedValue([]) }));

const hookState = vi.hoisted(() => ({ current: null as unknown as FetchedProfileState }));
vi.mock("../../hooks/usePlayerProfile", () => ({ usePlayerProfile: () => hookState.current }));

afterEach(() => {
  vi.unstubAllEnvs();
});

const cases = [
  {
    label: "own profile",
    profile: { ...viewerProfile, xp: 0 },
    props: buildBaseProps(),
  },
  {
    label: "another player's profile",
    profile: { ...opponentProfile, xp: 0 },
    props: { ...buildBaseProps(), viewedUid: opponentProfile.uid, isOwnProfile: false },
  },
];

describe.each(cases)("PlayerProfileScreen XP surfaces — $label", ({ profile, props }) => {
  function renderScreen() {
    hookState.current = fetchedState({ profile });
    return render(<PlayerProfileScreen {...props} />);
  }

  it("hides the level chip, the XP bar and the achievements ribbon while the XP flag is off", async () => {
    vi.stubEnv("VITE_FEATURE_XP_ENABLED", "false");
    renderScreen();
    expect(await screen.findByText(`@${profile.username}`)).toBeInTheDocument();
    expect(screen.queryByTestId("xp-progress")).toBeNull();
    expect(screen.queryByText(/\d+ \/ \d+ XP/)).toBeNull();
    expect(screen.queryByRole("img", { name: /^Level \d+$/ })).toBeNull();
    expect(screen.queryByTestId("achievements-ribbon")).toBeNull();
  });

  it("shows the level chip and the XP bar while the XP flag is on", async () => {
    vi.stubEnv("VITE_FEATURE_XP_ENABLED", "true");
    renderScreen();
    expect(await screen.findByTestId("xp-progress")).toBeInTheDocument();
    expect(screen.getByText("0 / 24 XP")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Level 1" })).toBeInTheDocument();
  });
});
