import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import { opponentProfile, buildCompletedGame, fetchedState } from "./playerProfile.test-helpers";

/**
 * The signed-out visitor: someone who followed a shared `/player/:uid` link
 * without an account. This is the app's growth surface, so the contract is
 * specific — public content renders, everything needing an identity does not,
 * and the page must offer a way in rather than dead-ending.
 *
 * Sibling specs cover the signed-in surfaces:
 *   - `PlayerProfileScreen.test.tsx`       → render states, history, block, challenge
 *   - `PlayerProfileScreen.smoke.test.tsx` → telemetry, share, placeholders
 *   - `PlayerProfileScreen.ptr.test.tsx`   → pull-to-refresh
 */

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: { profileViewed: vi.fn(), profileStatTileTapped: vi.fn() },
}));

vi.mock("../../services/blocking", () => ({ blockUser: vi.fn(), unblockUser: vi.fn() }));

const mockUsePlayerProfile = vi.fn();
vi.mock("../../hooks/usePlayerProfile", () => ({
  usePlayerProfile: (...args: unknown[]) => mockUsePlayerProfile(...args),
}));

import { analytics } from "../../services/analytics";
const analyticsMock = vi.mocked(analytics);

/** Props with NO `currentUserProfile` — the absent-viewer case. */
const visitorProps = {
  viewedUid: "u2",
  ownGames: [],
  isOwnProfile: false,
  onOpenGame: vi.fn(),
  onBack: vi.fn(),
};

describe("PlayerProfileScreen — signed-out visitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: { ...opponentProfile, isVerifiedPro: true } }));
  });

  // ── Public content still renders ────────────────────

  it("renders the shareable content: username, stance, verified-pro badge, stat tiles", () => {
    render(<PlayerProfileScreen {...visitorProps} />);
    expect(screen.getByText("@sk8rboi")).toBeInTheDocument();
    expect(screen.getByText("goofy")).toBeInTheDocument();
    expect(screen.getByTitle("Verified Pro")).toBeInTheDocument();
    // 10-3 clears the rated-games floor, so the public record is real.
    expect(screen.getByLabelText("Lifetime wins: 10")).toBeInTheDocument();
    expect(screen.getByLabelText("Lifetime losses: 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Win rate: 77 percent")).toBeInTheDocument();
  });

  it("labels Back for a visitor who has no lobby to return to", async () => {
    render(<PlayerProfileScreen {...visitorProps} />);
    await userEvent.click(screen.getByLabelText("Back to home"));
    expect(visitorProps.onBack).toHaveBeenCalledTimes(1);
  });

  // ── Sign-up CTA replaces Challenge ──────────────────

  it("offers a sign-up call to action naming the player", async () => {
    const onSignUp = vi.fn();
    render(<PlayerProfileScreen {...visitorProps} onSignUp={onSignUp} />);
    await userEvent.click(screen.getByRole("button", { name: "Sign up to challenge @sk8rboi" }));
    expect(onSignUp).toHaveBeenCalledTimes(1);
  });

  it("omits the CTA when the caller wires no sign-up route", () => {
    render(<PlayerProfileScreen {...visitorProps} />);
    expect(screen.queryByTestId("signup-to-challenge-cta")).not.toBeInTheDocument();
  });

  // ── Everything requiring an identity is withheld ────

  it("withholds the Challenge button even when a handler is passed", () => {
    // Challenging needs an account, so the handler must not become reachable
    // just because App wired one for the signed-in case.
    render(<PlayerProfileScreen {...visitorProps} onChallenge={vi.fn()} onSignUp={vi.fn()} />);
    expect(screen.queryByText("Challenge @sk8rboi")).not.toBeInTheDocument();
  });

  it("withholds the block controls", () => {
    render(<PlayerProfileScreen {...visitorProps} blockedUids={new Set()} />);
    expect(screen.queryByText("Block this player")).not.toBeInTheDocument();
  });

  it("withholds own-profile affordances", () => {
    render(<PlayerProfileScreen {...visitorProps} onAddSpot={vi.fn()} onEditProfile={vi.fn()} />);
    expect(screen.queryByTestId("share-my-profile-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("edit-profile-button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("added-spots-placeholder")).not.toBeInTheDocument();
  });

  it("omits the game history section rather than claiming there are no games", () => {
    // Firestore gates game reads on participation, so a visitor reads none.
    // "No games between you two yet" would be a false statement about a
    // player's record to someone who has no "you two".
    render(<PlayerProfileScreen {...visitorProps} />);
    expect(screen.queryByText("GAMES VS YOU")).not.toBeInTheDocument();
    expect(screen.queryByText("No games between you two yet")).not.toBeInTheDocument();
  });

  it("omits the head-to-head list even if games somehow arrive", () => {
    // Defence-in-depth: the controller skips the query, but a cached/offline
    // read must not surface an H2H record against a viewer who doesn't exist.
    mockUsePlayerProfile.mockReturnValue(fetchedState({ profile: opponentProfile, games: [buildCompletedGame()] }));
    render(<PlayerProfileScreen {...visitorProps} />);
    expect(screen.queryByText("HEAD TO HEAD")).not.toBeInTheDocument();
    expect(screen.queryByText("VS YOU")).not.toBeInTheDocument();
  });

  // ── Data + telemetry with an absent viewer ──────────

  it("skips the games query it could never be allowed to read", () => {
    render(<PlayerProfileScreen {...visitorProps} />);
    expect(mockUsePlayerProfile).toHaveBeenCalledWith("u2", undefined, false);
  });

  it("reports the view without inventing a viewer identity", () => {
    render(<PlayerProfileScreen {...visitorProps} />);
    expect(analyticsMock.profileViewed).toHaveBeenCalledTimes(1);
    const [viewerUid, profileUid, isSelf] = analyticsMock.profileViewed.mock.calls[0];
    // Empty uid is the codebase's "no identity" convention (useBlockedUsers("")
    // / usePlayerProfile("")); hashUid passes it through untouched, so the
    // event carries neither a fake uid nor a raw one.
    expect(viewerUid).toBe("");
    expect(profileUid).toBe("u2");
    expect(isSelf).toBe(false);
  });

  it("renders the not-found state without a viewer instead of crashing", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState());
    render(<PlayerProfileScreen {...visitorProps} />);
    expect(screen.getByText("Player not found")).toBeInTheDocument();
    expect(screen.getByText("Back to Home")).toBeInTheDocument();
  });

  it("renders the loading skeleton without a viewer", () => {
    mockUsePlayerProfile.mockReturnValue(fetchedState({ loading: true }));
    render(<PlayerProfileScreen {...visitorProps} />);
    expect(screen.getByRole("status", { name: /loading player profile/i })).toBeInTheDocument();
  });
});
