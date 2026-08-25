import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import {
  opponentProfile,
  buildBaseProps,
  fetchedState,
  getScrollContainer,
  pullPastTrigger,
} from "./playerProfile.test-helpers";

// These specs cover the pull-to-refresh *integration* at the screen level: the
// scroll-container wiring that the PTR regression bug lived in. The gesture
// mechanics themselves are owned by src/hooks/__tests__/usePullToRefresh.test.ts
// (renderHook). Here we assert the screen mounts its overflow-y-auto container,
// spreads the PTR pointer handlers onto *that* element for own profile, and
// omits both the handlers and the indicator for other players.

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: { profileViewed: vi.fn(), profileStatTileTapped: vi.fn() },
}));

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (s: string) => s?.startsWith("https://firebasestorage.googleapis.com"),
  LETTERS: ["S", "K", "A", "T", "E"],
}));

vi.mock("../../services/blocking", () => ({
  blockUser: vi.fn().mockResolvedValue(undefined),
  unblockUser: vi.fn().mockResolvedValue(undefined),
  isUserBlocked: vi.fn().mockResolvedValue(false),
  getBlockedUserIds: vi.fn().mockResolvedValue(new Set()),
}));

// Keep the haptic side-effect of crossing the PTR threshold inert so the
// gesture resolves without touching the native bridge.
vi.mock("../../services/haptics", () => ({
  playHaptic: vi.fn(),
}));

const mockUsePlayerProfile = vi.fn();

vi.mock("../../hooks/usePlayerProfile", () => ({
  usePlayerProfile: (...args: unknown[]) => mockUsePlayerProfile(...args),
}));

// The controller's Economy Phase A reads fire alongside the profile load. They
// resolve empty here so a late badge/locker render can never settle mid-gesture
// and perturb the offsets these specs assert on.
vi.mock("../../services/achievements", () => ({ fetchAchievements: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/locker", () => ({ fetchLockerItems: vi.fn().mockResolvedValue([]) }));

const baseProps = buildBaseProps();

describe("PlayerProfileScreen — pull-to-refresh integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePlayerProfile.mockReturnValue(fetchedState());
  });

  it("mounts a single scroll container at the root of own profile", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    const containers = document.querySelectorAll(".overflow-y-auto");
    expect(containers).toHaveLength(1);
    expect(containers[0]).toBeInTheDocument();
  });

  it("starts with no refresh indicator visible at rest", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    expect(screen.queryByText("Pull to refresh")).not.toBeInTheDocument();
    expect(screen.queryByText("Release to refresh")).not.toBeInTheDocument();
  });

  it("surfaces the refresh indicator when pulling the own-profile scroll container", () => {
    render(<PlayerProfileScreen {...baseProps} />);
    pullPastTrigger(getScrollContainer());
    // Crossing the trigger on a top-of-scroll pull flips the indicator to the
    // committed "Release to refresh" copy — proving the PTR handlers landed on
    // the actual scroll element, not a detached wrapper.
    expect(screen.getByText("Release to refresh")).toBeInTheDocument();
  });

  it("resolves the gesture and hides the indicator after release", async () => {
    render(<PlayerProfileScreen {...baseProps} />);
    const el = getScrollContainer();
    pullPastTrigger(el);
    fireEvent.pointerUp(el);
    // With no onRefreshProfile supplied the gesture still settles; once its
    // promise resolves the hook resets and the indicator unmounts (neither
    // committed nor refreshing copy remains).
    await waitFor(() => {
      expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Release to refresh")).not.toBeInTheDocument();
  });

  it("refetches the signed-in user's profile when the gesture completes", async () => {
    // The gesture used to animate without refetching anything, so a user whose
    // wins/losses had just been incremented server-side by applyGameStats had
    // no way to pull their own new record into a one-time-read profile.
    const onRefreshProfile = vi.fn().mockResolvedValue(undefined);
    render(<PlayerProfileScreen {...baseProps} onRefreshProfile={onRefreshProfile} />);
    const el = getScrollContainer();
    pullPastTrigger(el);
    fireEvent.pointerUp(el);
    await waitFor(() => expect(onRefreshProfile).toHaveBeenCalledTimes(1));
  });

  it("does not refetch when the pull never crosses the trigger threshold", async () => {
    const onRefreshProfile = vi.fn().mockResolvedValue(undefined);
    render(<PlayerProfileScreen {...baseProps} onRefreshProfile={onRefreshProfile} />);
    const el = getScrollContainer();
    fireEvent.pointerUp(el);
    await waitFor(() => expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument());
    expect(onRefreshProfile).not.toHaveBeenCalled();
  });

  it("does not wire PTR on another player's profile", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    // Pulling the other-player container must be inert: no handlers are spread,
    // so no indicator can ever appear.
    pullPastTrigger(getScrollContainer());
    expect(screen.queryByText("Release to refresh")).not.toBeInTheDocument();
    expect(screen.queryByText("Pull to refresh")).not.toBeInTheDocument();
  });
});
