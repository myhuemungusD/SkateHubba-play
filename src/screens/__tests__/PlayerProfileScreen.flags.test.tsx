import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { UserProfile } from "../../services/users";
import { DEFAULT_PROFILE_CUSTOM, type SectionId } from "../../services/profileCustom";
import { buildBaseProps, fetchedState, opponentProfile, viewerProfile } from "./playerProfile.test-helpers";

/**
 * Flag-gated wiring of PlayerProfileScreen: which optional sections mount and
 * which props/callbacks they receive. The sections themselves are stubbed to
 * echo their props; their behaviour is covered in their own specs.
 */

const h = vi.hoisted(() => ({
  profileViewed: vi.fn(),
  trackEvent: vi.fn(),
  fetched: vi.fn(),
  sections: ["clips", "spots"] as SectionId[],
}));

vi.mock("../../services/analytics", () => ({
  trackEvent: h.trackEvent,
  analytics: { profileViewed: h.profileViewed, profileStatTileTapped: () => undefined },
}));
vi.mock("../../services/blocking", () => ({ blockUser: async () => undefined, unblockUser: async () => undefined }));
vi.mock("../../services/achievements", () => ({ fetchAchievements: async () => [] }));
vi.mock("../../services/locker", () => ({ fetchLockerItems: async () => [] }));
vi.mock("../../hooks/usePlayerProfile", () => ({ usePlayerProfile: h.fetched }));
vi.mock("../PlayerProfileScreen/components/custom/useProfileCustom", () => ({
  useProfileCustom: () => ({
    custom: { ...DEFAULT_PROFILE_CUSTOM, sections: h.sections },
    pinned: [],
    applySaved: async () => undefined,
  }),
}));
vi.mock("../../components/pro/ProPicks", () => ({
  PropsRow: ({ uid }: { uid: string }) => <div data-testid="props-row">{uid}</div>,
}));
vi.mock("../../components/SpotPassport", () => ({
  SpotPassport: (p: { uid: string; isOwner: boolean }) => <div data-testid="passport">{`${p.uid}:${p.isOwner}`}</div>,
}));
vi.mock("../PlayerProfileScreen/components/AchievementsRibbon", () => ({
  AchievementsRibbon: () => <div data-testid="ribbon" />,
}));
vi.mock("../PlayerProfileScreen/components/custom/PinnedClips", () => ({
  PinnedClips: (p: { editor?: { uid: string; username: string } }) => (
    <div data-testid="pinned">{p.editor ? `${p.editor.uid}/${p.editor.username}` : "read-only"}</div>
  ),
}));
vi.mock("../PlayerProfileScreen/components/AddedSpotsSection", () => ({
  AddedSpotsSection: (p: { onAddSpot?: () => void }) =>
    p.onAddSpot ? (
      <button type="button" onClick={p.onAddSpot}>
        add spot
      </button>
    ) : (
      <div data-testid="spots-no-cta" />
    ),
}));
vi.mock("../PlayerProfileScreen/components/ProShowcaseGate", () => ({
  ProShowcaseGate: (p: { stance: string; onOpenProTools?: () => void }) => (
    <div data-testid="pro-gate" data-stance={p.stance}>
      {p.onOpenProTools && (
        <button type="button" onClick={p.onOpenProTools}>
          pro tools
        </button>
      )}
    </div>
  ),
}));

import { PlayerProfileScreen } from "../PlayerProfileScreen";

const pro: UserProfile = { ...viewerProfile, isVerifiedPro: true };

beforeEach(() => {
  h.sections = ["clips", "spots"];
  h.fetched.mockReturnValue(fetchedState({ profile: opponentProfile }));
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("PlayerProfileScreen flag wiring", () => {
  it("fires profile_viewed once even when the viewed player changes", () => {
    const { rerender } = render(<PlayerProfileScreen {...buildBaseProps()} />);
    rerender(<PlayerProfileScreen {...buildBaseProps()} viewedUid="u2" isOwnProfile={false} />);
    expect(h.profileViewed).toHaveBeenCalledTimes(1);
    expect(h.profileViewed).toHaveBeenCalledWith("me", "me", true, expect.any(Number));
  });

  it("leaves the props row out with pro community off", () => {
    render(<PlayerProfileScreen {...buildBaseProps()} />);
    expect(screen.getByTestId("pro-gate")).toBeInTheDocument();
    expect(screen.queryByTestId("props-row")).toBeNull();
  });

  it("shows the props row only with pro community on", () => {
    vi.stubEnv("VITE_FEATURE_PRO_COMMUNITY", "true");
    render(<PlayerProfileScreen {...buildBaseProps()} />);
    expect(screen.getByTestId("props-row")).toHaveTextContent("me");
  });

  it("passes an empty stance to the pro showcase when the player never set one", () => {
    render(
      <PlayerProfileScreen
        {...buildBaseProps()}
        currentUserProfile={{ ...viewerProfile, stance: undefined as never }}
      />,
    );
    expect(screen.getByTestId("pro-gate")).toHaveAttribute("data-stance", "");
  });

  it("gives a verified pro the Pro tools entry on their own profile only", () => {
    const onOpenProTools = vi.fn();
    const { unmount } = render(
      <PlayerProfileScreen {...buildBaseProps()} currentUserProfile={pro} onOpenProTools={onOpenProTools} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "pro tools" }));
    expect(onOpenProTools).toHaveBeenCalledTimes(1);
    unmount();
    render(<PlayerProfileScreen {...buildBaseProps()} onOpenProTools={onOpenProTools} />);
    expect(screen.queryByRole("button", { name: "pro tools" })).toBeNull();
  });

  it("mounts the spot passport for a signed-in viewer with check-ins on", () => {
    vi.stubEnv("VITE_FEATURE_MAP_CHECKINS", "true");
    render(<PlayerProfileScreen {...buildBaseProps()} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByTestId("passport")).toHaveTextContent("u2:false");
  });

  it("skips the spot passport for a signed-out visitor", () => {
    vi.stubEnv("VITE_FEATURE_MAP_CHECKINS", "true");
    render(<PlayerProfileScreen {...buildBaseProps()} currentUserProfile={null} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByTestId("pro-gate")).toBeInTheDocument();
    expect(screen.queryByTestId("passport")).toBeNull();
  });

  it("shows the achievements ribbon with XP on, in the classic layout", () => {
    vi.stubEnv("VITE_FEATURE_XP_ENABLED", "true");
    render(<PlayerProfileScreen {...buildBaseProps()} />);
    expect(screen.getByTestId("ribbon")).toBeInTheDocument();
  });
});

describe("PlayerProfileScreen custom layout flags", () => {
  beforeEach(() => vi.stubEnv("VITE_FEATURE_PROFILE_CUSTOM", "true"));

  it("shows the achievements ribbon with XP on", () => {
    vi.stubEnv("VITE_FEATURE_XP_ENABLED", "true");
    render(<PlayerProfileScreen {...buildBaseProps()} />);
    expect(screen.getByTestId("ribbon")).toBeInTheDocument();
    expect(screen.getByTestId("custom-section-clips")).toBeInTheDocument();
  });

  it("hands the owner the clip editor when it is on", () => {
    vi.stubEnv("VITE_FEATURE_CLIP_EDITOR", "true");
    render(<PlayerProfileScreen {...buildBaseProps()} />);
    expect(screen.getByTestId("pinned")).toHaveTextContent("me/viewer");
  });

  it("keeps pinned clips read-only for visitors even with the editor on", () => {
    vi.stubEnv("VITE_FEATURE_CLIP_EDITOR", "true");
    render(<PlayerProfileScreen {...buildBaseProps()} viewedUid="u2" isOwnProfile={false} />);
    expect(screen.getByTestId("pinned")).toHaveTextContent("read-only");
  });

  it("wires the owner's Add a spot through telemetry when extras are on", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    const onAddSpot = vi.fn();
    render(<PlayerProfileScreen {...buildBaseProps()} onAddSpot={onAddSpot} />);
    fireEvent.click(screen.getByRole("button", { name: "add spot" }));
    expect(h.trackEvent).toHaveBeenCalledWith(
      "profile_add_a_spot_tapped",
      expect.objectContaining({ uid: expect.any(String) }),
    );
    expect(onAddSpot).toHaveBeenCalledTimes(1);
  });

  it("renders the spots section without a CTA when no add-spot route is wired", () => {
    vi.stubEnv("VITE_FEATURE_EXTRAS_ENABLED", "true");
    render(<PlayerProfileScreen {...buildBaseProps()} />);
    expect(screen.getByTestId("spots-no-cta")).toBeInTheDocument();
  });
});
