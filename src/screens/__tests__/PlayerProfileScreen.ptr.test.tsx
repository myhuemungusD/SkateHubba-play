import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import {
  opponentProfile as otherProfile,
  buildBaseProps,
  fetchedState,
  getScrollContainer as scrollContainer,
  pullPastTrigger,
} from "./playerProfileTestHelpers";

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
    pullPastTrigger(scrollContainer());
    // Crossing the trigger on a top-of-scroll pull flips the indicator to the
    // committed "Release to refresh" copy — proving the PTR handlers landed on
    // the actual scroll element, not a detached wrapper.
    expect(screen.getByText("Release to refresh")).toBeInTheDocument();
  });

  it("resolves the gesture and hides the indicator after release", async () => {
    render(<PlayerProfileScreen {...baseProps} />);
    const el = scrollContainer();
    pullPastTrigger(el);
    fireEvent.pointerUp(el);
    // The own-profile onRefresh is an async no-op; once its promise settles the
    // hook resets and the indicator unmounts (neither committed nor refreshing
    // copy remains).
    await waitFor(() => {
      expect(screen.queryByText("Refreshing…")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Release to refresh")).not.toBeInTheDocument();
  });

  it("does not wire PTR on another player's profile", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: otherProfile }));
    render(<PlayerProfileScreen {...baseProps} viewedUid="u2" isOwnProfile={false} />);
    // Pulling the other-player container must be inert: no handlers are spread,
    // so no indicator can ever appear.
    pullPastTrigger(scrollContainer());
    expect(screen.queryByText("Release to refresh")).not.toBeInTheDocument();
    expect(screen.queryByText("Pull to refresh")).not.toBeInTheDocument();
  });
});
