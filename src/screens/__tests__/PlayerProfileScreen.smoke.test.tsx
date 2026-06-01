import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import {
  viewerProfile,
  opponentProfile,
  buildCompletedGame,
  buildBaseProps,
  fetchedState,
} from "./playerProfile.test-helpers";

/**
 * Smoke coverage for PlayerProfileScreen (board item P3).
 *
 * Scope is deliberately the slices the two sibling specs do NOT assert:
 *   - `PlayerProfileScreen.test.tsx`     → render states, game history, block,
 *                                          challenge, "Share Game" recap.
 *   - `PlayerProfileScreen.ptr.test.tsx` → pull-to-refresh container wiring.
 *
 * This file owns the remaining user-visible contracts:
 *   - `profile_viewed` mount telemetry (self vs. other).
 *   - `profile_stat_tile_tapped` engagement telemetry.
 *   - "Share my profile" (own-profile) Web Share / clipboard fallback.
 *   - Placeholder section visibility rules (achievements / added-spots).
 *   - Custom avatar image rendering from `profileImageUrl`.
 *
 * Assertions are outcome-based (telemetry args, visible copy, callback
 * invocation) so they survive internal refactors of the controller/components.
 */

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: { profileViewed: vi.fn(), profileStatTileTapped: vi.fn() },
}));

import { analytics, trackEvent } from "../../services/analytics";
const analyticsMock = vi.mocked(analytics);
const trackEventMock = vi.mocked(trackEvent);

vi.mock("../../utils/helpers", () => ({
  isFirebaseStorageUrl: (value: string) => value?.startsWith("https://firebasestorage.googleapis.com"),
  LETTERS: ["S", "K", "A", "T", "E"],
}));

// These specs never enter a block/unblock flow — the module is mocked only so
// the controller's import resolves without touching Firebase. Block behavior
// itself is covered by PlayerProfileScreen.test.tsx.
vi.mock("../../services/blocking", () => ({
  blockUser: vi.fn(),
  unblockUser: vi.fn(),
}));

const fetchedProfile = vi.fn();
vi.mock("../../hooks/usePlayerProfile", () => ({
  usePlayerProfile: (...args: unknown[]) => fetchedProfile(...args),
}));

/** Configure the other-player fetch hook for an opponent render. */
function withOpponentFetch(games = [buildCompletedGame()]): void {
  fetchedProfile.mockReturnValue(fetchedState({ profile: opponentProfile, games }));
}

const props = buildBaseProps();

describe("PlayerProfileScreen — smoke (telemetry, share, placeholders)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchedProfile.mockReturnValue(fetchedState());
  });

  // ── profile_viewed mount telemetry ──────────────────

  it("emits profile_viewed with isSelf=true on the viewer's own profile", () => {
    render(<PlayerProfileScreen {...props} />);
    expect(analyticsMock.profileViewed).toHaveBeenCalledTimes(1);
    const [viewerUid, profileUid, isSelf, ms] = analyticsMock.profileViewed.mock.calls[0];
    expect(viewerUid).toBe("me");
    expect(profileUid).toBe("me");
    expect(isSelf).toBe(true);
    expect(typeof ms).toBe("number");
  });

  it("emits profile_viewed with isSelf=false when opening another player", () => {
    withOpponentFetch([]);
    render(<PlayerProfileScreen {...props} viewedUid="u2" isOwnProfile={false} />);
    const call = analyticsMock.profileViewed.mock.calls[0];
    expect(call[1]).toBe("u2");
    expect(call[2]).toBe(false);
  });

  // ── profile_stat_tile_tapped engagement telemetry ───

  it("emits profile_stat_tile_tapped with the tapped tile name and viewed uid", async () => {
    render(<PlayerProfileScreen {...props} />);
    await userEvent.click(screen.getByRole("button", { name: /lifetime wins/i }));
    expect(analyticsMock.profileStatTileTapped).toHaveBeenCalledWith("wins", "me");
  });

  // ── "Share my profile" (own-profile) — distinct from "Share Game" ─

  describe("Share my profile", () => {
    afterEach(() => {
      Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
    });

    it("invokes the Web Share sheet with a deep link to the viewer's profile", async () => {
      const share = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, "share", { value: share, writable: true, configurable: true });

      render(<PlayerProfileScreen {...props} />);
      await userEvent.click(screen.getByTestId("share-my-profile-button"));

      await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
      expect(share.mock.calls[0][0]).toMatchObject({ url: expect.stringContaining("/profile/me") });
      expect(trackEventMock).toHaveBeenCalledWith("profile_share_my_profile_tapped", { uid: "me" });
    });

    it("copies the link and surfaces LINK COPIED when Web Share is unavailable", async () => {
      Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<PlayerProfileScreen {...props} />);
      await userEvent.click(screen.getByTestId("share-my-profile-button"));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/profile/me")));
      expect(await screen.findByText("LINK COPIED")).toBeInTheDocument();
    });

    it("does not render the share-my-profile button on another player's profile", () => {
      withOpponentFetch([]);
      render(<PlayerProfileScreen {...props} viewedUid="u2" isOwnProfile={false} />);
      expect(screen.queryByTestId("share-my-profile-button")).not.toBeInTheDocument();
    });
  });

  // ── Placeholder sections — visibility rules ─────────

  it("shows the achievements ribbon on the viewer's own profile", () => {
    render(<PlayerProfileScreen {...props} />);
    expect(screen.getByTestId("achievements-ribbon")).toBeInTheDocument();
  });

  it("renders the added-spots placeholder only on the viewer's own profile", () => {
    render(<PlayerProfileScreen {...props} />);
    expect(screen.getByTestId("added-spots-placeholder")).toBeInTheDocument();
  });

  it("hides the added-spots placeholder on another player's profile", () => {
    withOpponentFetch();
    render(<PlayerProfileScreen {...props} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.queryByTestId("added-spots-placeholder")).not.toBeInTheDocument();
    // The achievements ribbon, by contrast, renders for everyone.
    expect(screen.getByTestId("achievements-ribbon")).toBeInTheDocument();
  });

  // ── Avatar rendering ────────────────────────────────

  it("renders the opponent's custom avatar image from profileImageUrl", () => {
    const url = "https://firebasestorage.googleapis.com/avatar.webp";
    fetchedProfile.mockReturnValue(fetchedState({ profile: { ...opponentProfile, profileImageUrl: url } }));
    render(<PlayerProfileScreen {...props} viewedUid="u2" isOwnProfile={false} />);
    expect(document.querySelector(`img[src="${url}"]`)).toBeInTheDocument();
  });

  it("renders the username initial when the viewer has no custom avatar", () => {
    render(<PlayerProfileScreen {...props} currentUserProfile={{ ...viewerProfile, profileImageUrl: null }} />);
    // Fallback chain: no profileImageUrl → first-letter circle ("V" for viewer).
    expect(screen.getByText("V")).toBeInTheDocument();
  });
});
