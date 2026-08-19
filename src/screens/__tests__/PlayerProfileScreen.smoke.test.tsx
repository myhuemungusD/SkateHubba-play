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
import { hashUid } from "../../utils/pii";
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

// Economy Phase A reads the controller fires alongside the profile load —
// mocked to resolve empty so the placeholder-visibility specs below see the
// earned-nothing state (both sections render null / owner-only hint).
vi.mock("../../services/achievements", () => ({ fetchAchievements: vi.fn().mockResolvedValue([]) }));
vi.mock("../../services/locker", () => ({ fetchLockerItems: vi.fn().mockResolvedValue([]) }));

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
      // Must be `/player/:uid` — the public profile route. `/profile` is the
      // profile-setup route and matches exactly, so a `/profile/{uid}` link
      // redirects to /404. Asserted as a full path, not `stringContaining`,
      // so a regression back to the broken route cannot pass.
      expect(share.mock.calls[0][0]).toMatchObject({
        url: `${window.location.origin}/player/me`,
      });
      // uid is hashed before it reaches analytics — raw Firebase uids never
      // leave the app (privacy sweep; matches every other analytics call site).
      expect(trackEventMock).toHaveBeenCalledWith("profile_share_my_profile_tapped", { uid: hashUid("me") });
    });

    it("copies the link and surfaces LINK COPIED when Web Share is unavailable", async () => {
      Object.defineProperty(navigator, "share", { value: undefined, writable: true, configurable: true });
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });

      render(<PlayerProfileScreen {...props} />);
      await userEvent.click(screen.getByTestId("share-my-profile-button"));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/player/me`));
      expect(await screen.findByText("LINK COPIED")).toBeInTheDocument();
    });

    it("does not render the share-my-profile button on another player's profile", () => {
      withOpponentFetch([]);
      render(<PlayerProfileScreen {...props} viewedUid="u2" isOwnProfile={false} />);
      expect(screen.queryByTestId("share-my-profile-button")).not.toBeInTheDocument();
    });
  });

  // ── "Edit profile" (own-profile) ────────────────────

  describe("Edit profile", () => {
    it("routes EDIT PROFILE to the caller's settings navigation", async () => {
      const onEditProfile = vi.fn();
      render(<PlayerProfileScreen {...props} onEditProfile={onEditProfile} />);
      await userEvent.click(screen.getByTestId("edit-profile-button"));
      expect(onEditProfile).toHaveBeenCalledTimes(1);
    });

    it("omits the button entirely when the caller wires no edit route", () => {
      // An inert button sitting next to Share reads as a broken app; the
      // screen renders nothing rather than a dead affordance.
      render(<PlayerProfileScreen {...props} />);
      expect(screen.queryByTestId("edit-profile-button")).not.toBeInTheDocument();
    });

    it("does not render the edit button on another player's profile", () => {
      // App passes `isOwn ? onEditProfile : undefined`, but the screen must
      // hold the line itself — you cannot edit someone else's profile.
      withOpponentFetch([]);
      render(<PlayerProfileScreen {...props} viewedUid="u2" isOwnProfile={false} onEditProfile={vi.fn()} />);
      expect(screen.queryByTestId("edit-profile-button")).not.toBeInTheDocument();
    });
  });

  // ── Placeholder sections — visibility rules ─────────

  it("does not render the achievements ribbon on the viewer's own profile", () => {
    // The ribbon is 12 grayscale "???" tiles that can never unlock: there is
    // no `users/{uid}/achievements` collection to subscribe to. Shipping it
    // on a live profile just advertises an unfinished product. The component
    // and its own spec are kept so re-enabling is a one-line change.
    render(<PlayerProfileScreen {...props} />);
    expect(screen.queryByTestId("achievements-ribbon")).not.toBeInTheDocument();
  });

  it("renders the added-spots placeholder on the viewer's own profile", () => {
    // Kept (unlike the ribbon) because its CTA is a real, working action —
    // it opens the map's Add Spot sheet. Only the list below it is empty.
    render(<PlayerProfileScreen {...props} />);
    expect(screen.getByTestId("added-spots-placeholder")).toBeInTheDocument();
  });

  it("routes ADD A SPOT to the caller's map navigation", async () => {
    // The CTA used to render permanently disabled because the screen never
    // passed `onAddSpot` down, even though the map/add-spot flow already
    // existed. Guards the wiring, not just the markup.
    const onAddSpot = vi.fn();
    render(<PlayerProfileScreen {...props} onAddSpot={onAddSpot} />);
    const cta = screen.getByRole("button", { name: /add a spot/i });
    expect(cta).toBeEnabled();
    await userEvent.click(cta);
    expect(onAddSpot).toHaveBeenCalledTimes(1);
    expect(trackEventMock).toHaveBeenCalledWith("profile_add_a_spot_tapped", {
      uid: hashUid("me"),
    });
  });

  it("disables ADD A SPOT when the caller supplies no map navigation", () => {
    render(<PlayerProfileScreen {...props} />);
    expect(screen.getByRole("button", { name: /add a spot/i })).toBeDisabled();
  });

  it("hides both unbuilt-feature placeholders on another player's profile", () => {
    // The added-spots CTA is owner-only (a visitor can't add spots "for" you),
    // and the achievements ribbon is now hidden everywhere. Retained as the
    // regression guard for the other-player surface specifically.
    withOpponentFetch();
    render(<PlayerProfileScreen {...props} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.queryByTestId("added-spots-placeholder")).not.toBeInTheDocument();
    expect(screen.queryByTestId("achievements-ribbon")).not.toBeInTheDocument();
  });

  // ── Win-rate floor ──────────────────────────────────

  it("withholds the win rate for a profile below the rated-games floor", () => {
    // The viewer fixture has no wins/losses at all. Showing "0%" here would
    // assert something untrue about a player who has simply never played.
    render(<PlayerProfileScreen {...props} />);
    expect(screen.getByLabelText(/win rate: not enough games yet/i)).toBeInTheDocument();
  });

  it("shows a real win rate once the profile clears the floor", () => {
    // Opponent fixture is 10-3 → 13 games, comfortably rated. 10/13 ≈ 77%.
    withOpponentFetch();
    render(<PlayerProfileScreen {...props} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByLabelText("Win rate: 77 percent")).toBeInTheDocument();
  });

  // ── Win-streak banner ───────────────────────────────

  it("shows the win-streak banner once a run reaches two games", () => {
    render(<PlayerProfileScreen {...props} currentUserProfile={{ ...viewerProfile, currentWinStreak: 3 }} />);
    expect(screen.getByRole("status", { name: "3 game win streak" })).toBeInTheDocument();
  });

  it("hides the win-streak banner for a single win", () => {
    // A "1 win streak" is just a win — the banner marks a run, not a result.
    render(<PlayerProfileScreen {...props} currentUserProfile={{ ...viewerProfile, currentWinStreak: 1 }} />);
    expect(screen.queryByRole("status", { name: /win streak/i })).not.toBeInTheDocument();
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
