import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PlayerProfileScreen } from "../PlayerProfileScreen";
import { buildBaseProps, fetchedState } from "./playerProfile.test-helpers";
import { buildLockerItem } from "../../components/__tests__/economy.test-helpers";
import { MIKE_WHITE_COLLECTION } from "../../lib/closet/mikeWhiteCollection";
import { DEFAULT_PROFILE_CUSTOM, type ProfileCustom } from "../../services/profileCustom";

vi.mock("../../services/analytics", () => ({
  trackEvent: vi.fn(),
  analytics: { profileViewed: vi.fn(), profileStatTileTapped: vi.fn() },
}));
vi.mock("../../services/blocking", () => ({ blockUser: vi.fn(), unblockUser: vi.fn() }));
vi.mock("../../services/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
const mockLocker = vi.fn();
vi.mock("../../services/achievements", () => ({ fetchAchievements: async () => [] }));
vi.mock("../../services/locker", () => ({ fetchLockerItems: (...a: unknown[]) => mockLocker(...a) }));
vi.mock("../../hooks/usePlayerProfile", () => ({ usePlayerProfile: () => fetchedState() }));

const m = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  pinnable: vi.fn(),
  pinned: vi.fn(),
}));
vi.mock("../../services/profileCustom", async (orig) => {
  const real = await orig<typeof import("../../services/profileCustom")>();
  return {
    ...real,
    getProfileCustom: m.get,
    saveProfileCustom: m.save,
    fetchPinnableClips: m.pinnable,
    resolvePinnedClips: m.pinned,
  };
});

const props = buildBaseProps();
const full: ProfileCustom = {
  ...DEFAULT_PROFILE_CUSTOM,
  accent: "#0A84FF",
  sections: ["crew", "clips", "stats", "closet", "spots"],
  pinnedClipIds: ["c1"],
  bio: "Mike White designs",
  links: [{ label: "IG", url: "https://www.instagram.com/mike" }],
  sponsors: [
    { name: "B-One", url: "" },
    { name: "Shop", url: "https://mike.myshopify.com" },
  ],
  favoriteTricks: ["Kickflip"],
  themeSongId: "lofi-75",
};

class FakeAudio {
  static last: FakeAudio | null = null;
  loop = false;
  volume = 1;
  play = vi.fn(() => Promise.resolve());
  pause = vi.fn();
  constructor(public src: string) {
    FakeAudio.last = this;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("VITE_FEATURE_PROFILE_CUSTOM", "true");
  vi.stubEnv("VITE_FEATURE_PROFILE_BANNER", "true");
  // The closet section + signature toggle only exist behind the Closet flag.
  vi.stubEnv("VITE_FEATURE_CLOSET_ENABLED", "true");
  vi.stubGlobal("Audio", FakeAudio);
  mockLocker.mockResolvedValue([]);
  m.get.mockResolvedValue(full);
  // Every pin resolves (none pruned); only c1 has a clip to render.
  m.pinned.mockImplementation(async (_uid: string, ids: string[]) => ({
    clips: [{ id: "c1", trickName: "Tre flip", videoUrl: "v.mp4", thumbnailUrl: null }],
    keepIds: ids,
  }));
  m.pinnable.mockResolvedValue([
    { id: "c1", trickName: "Tre flip", videoUrl: "v.mp4", thumbnailUrl: null },
    { id: "c2", trickName: "Heelflip", videoUrl: "v2.mp4", thumbnailUrl: "t.jpg" },
  ]);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PlayerProfileScreen — custom profile (flag on)", () => {
  it("renders about, links, sponsors, pinned clips and the chosen section order", async () => {
    render(<PlayerProfileScreen {...props} />);
    expect(await screen.findByText("Mike White designs")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "IG" })).toHaveAttribute("href", "https://www.instagram.com/mike");
    expect(screen.getByRole("link", { name: "Shop" })).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(screen.getByText("B-One")).toBeInTheDocument();
    expect(screen.getByText("Kickflip")).toBeInTheDocument();
    expect(await screen.findByTestId("pinned-clips")).toHaveTextContent("Tre flip");
    const ids = screen.getAllByTestId(/^custom-section-/).map((el) => el.dataset.testid);
    expect(ids).toEqual(full.sections.map((s) => `custom-section-${s}`));
  });

  it("plays and pauses the theme song on tap only", async () => {
    render(<PlayerProfileScreen {...props} />);
    const btn = await screen.findByRole("button", { name: /Play theme song/ });
    expect(FakeAudio.last).toBeNull();
    fireEvent.click(btn);
    expect(FakeAudio.last?.play).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /Pause theme song/ }));
    expect(FakeAudio.last?.pause).toHaveBeenCalled();
  });

  it("highlights Mike White Signature items with their credit", async () => {
    const mike = MIKE_WHITE_COLLECTION[0];
    mockLocker.mockResolvedValue([
      buildLockerItem({ id: "m1", itemDefId: mike.itemDefId, name: "M1", imageUrl: "https://x/m.png" }),
      buildLockerItem({ id: "d1" }),
    ]);
    render(<PlayerProfileScreen {...props} />);
    const sec = await screen.findByTestId("signature-showcase");
    expect(sec).toHaveTextContent("Designed by Mike White");
  });

  it("shows nothing extra for a blank customization", async () => {
    m.get.mockResolvedValue(null);
    render(<PlayerProfileScreen {...props} />);
    await waitFor(() => expect(m.get).toHaveBeenCalled());
    expect(screen.queryByTestId("profile-about")).toBeNull();
    expect(screen.queryByTestId("pinned-clips")).toBeNull();
    expect(m.pinned).not.toHaveBeenCalled();
  });

  it("edits look, layout and about, then saves", async () => {
    m.save.mockImplementation(async (_uid: string, v: ProfileCustom) => v);
    render(<PlayerProfileScreen {...props} />);
    await screen.findByText("Mike White designs");
    fireEvent.click(screen.getByTestId("customize-profile-button"));
    const sheet = screen.getByTestId("profile-customize-sheet");
    expect(sheet).toBeInTheDocument();

    // Look
    fireEvent.click(screen.getByRole("button", { name: "Accent #FF2D55" }));
    fireEvent.change(screen.getByLabelText("Gradient top custom color"), { target: { value: "#123456" } });
    fireEvent.change(screen.getAllByRole("slider")[0], { target: { value: "90" } });
    fireEvent.change(screen.getAllByRole("slider")[1], { target: { value: "10" } });
    fireEvent.change(screen.getAllByRole("slider")[2], { target: { value: "20" } });
    fireEvent.change(screen.getAllByRole("slider")[3], { target: { value: "150" } });

    // Layout
    fireEvent.click(screen.getByRole("tab", { name: "LAYOUT" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Pinned clips up" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Spots down" }));
    fireEvent.click(screen.getByRole("button", { name: "Move Crew down" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(await screen.findByRole("button", { name: /Heelflip/ }));

    // About
    fireEvent.click(screen.getByRole("tab", { name: "ABOUT" }));
    fireEvent.change(screen.getByRole("textbox", { name: /bio/i }), { target: { value: "new bio" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove Kickflip" }));
    fireEvent.change(screen.getByLabelText("New trick"), { target: { value: " Nollie " } });
    fireEvent.click(screen.getAllByRole("button", { name: "ADD" })[0]);
    fireEvent.change(screen.getByLabelText("Link label"), { target: { value: "Bad" } });
    fireEvent.change(screen.getByLabelText("Link URL"), { target: { value: "https://evil.com" } });
    expect(screen.getAllByRole("button", { name: "ADD" })[1]).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Link URL"), { target: { value: "https://tiktok.com/@mike" } });
    fireEvent.click(screen.getAllByRole("button", { name: "ADD" })[1]);
    fireEvent.click(screen.getByRole("button", { name: "Remove IG" }));
    fireEvent.change(screen.getByLabelText("Sponsor name"), { target: { value: "Deck Co" } });
    fireEvent.click(screen.getAllByRole("button", { name: "ADD" })[2]);
    fireEvent.click(screen.getByRole("button", { name: "Remove B-One" }));
    fireEvent.change(screen.getByLabelText("Theme song"), { target: { value: "punk-170" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    });
    const saved = m.save.mock.calls[0][1] as ProfileCustom;
    expect(saved).toMatchObject({
      accent: "#FF2D55",
      gradientFrom: "#123456",
      gradientAngle: 90,
      bannerPosX: 10,
      bannerPosY: 20,
      bannerZoom: 150,
      showcaseSignature: false,
      pinnedClipIds: ["c1", "c2"],
      bio: "new bio",
      favoriteTricks: ["Nollie"],
      links: [{ label: "Bad", url: "https://tiktok.com/@mike" }],
      sponsors: [
        { name: "Shop", url: "https://mike.myshopify.com" },
        { name: "Deck Co", url: "" },
      ],
      themeSongId: "punk-170",
    });
    expect(saved.sections).toEqual(["clips", "stats", "crew", "closet", "spots"]);
    expect(screen.queryByTestId("profile-customize-sheet")).toBeNull();
    expect(await screen.findByText("new bio")).toBeInTheDocument();
  });

  it("shows an error when saving fails and closes on X", async () => {
    m.save.mockRejectedValue(new Error("denied"));
    m.pinnable.mockResolvedValue([]);
    render(<PlayerProfileScreen {...props} />);
    await screen.findByText("Mike White designs");
    fireEvent.click(screen.getByTestId("customize-profile-button"));
    fireEvent.click(screen.getByRole("tab", { name: "LAYOUT" }));
    expect(await screen.findByText("Post a clip to pin it here.")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't save");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByTestId("profile-customize-sheet")).toBeNull();
  });

  it("does not read or render custom profile pieces when the flag is off", async () => {
    vi.stubEnv("VITE_FEATURE_PROFILE_CUSTOM", "");
    render(<PlayerProfileScreen {...props} />);
    await screen.findByTestId("player-profile-root");
    expect(m.get).not.toHaveBeenCalled();
    expect(screen.queryByTestId("customize-profile-button")).toBeNull();
  });
});

describe("PlayerProfileScreen — custom profile with the Closet flag off (iOS 1.2.0)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_FEATURE_CLOSET_ENABLED", "false");
    const mike = MIKE_WHITE_COLLECTION[0];
    mockLocker.mockResolvedValue([
      buildLockerItem({ id: "m1", itemDefId: mike.itemDefId, name: "M1", imageUrl: "https://x/m.png", equipped: true }),
    ]);
  });

  it("never reads the locker and renders no closet section, signature or showcase", async () => {
    render(<PlayerProfileScreen {...props} />);
    expect(await screen.findByText("Mike White designs")).toBeInTheDocument();
    expect(await screen.findByTestId("pinned-clips")).toBeInTheDocument();
    expect(mockLocker).not.toHaveBeenCalled();
    expect(screen.queryByTestId("signature-showcase")).toBeNull();
    expect(screen.queryByTestId("profile-showcase")).toBeNull();
    expect(screen.queryByTestId("closet-showcase")).toBeNull();
    expect(screen.getByTestId("custom-section-closet")).toBeEmptyDOMElement();
  });

  it("hides the Closet showcase option and signature toggle, and moves past the hidden slot", async () => {
    m.save.mockImplementation(async (_uid: string, v: ProfileCustom) => v);
    render(<PlayerProfileScreen {...props} />);
    await screen.findByText("Mike White designs");
    fireEvent.click(screen.getByTestId("customize-profile-button"));
    fireEvent.click(screen.getByRole("tab", { name: "LAYOUT" }));
    expect(screen.queryByText("Closet showcase")).toBeNull();
    expect(screen.queryByText("Highlight signature pieces")).toBeNull();
    expect(screen.getByRole("button", { name: "Move Spots up" })).toBeEnabled();
    // Stats sits next to the hidden closet slot; "down" must jump to Spots.
    fireEvent.click(screen.getByRole("button", { name: "Move Stats down" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "SAVE" }));
    });
    const saved = m.save.mock.calls[0][1] as ProfileCustom;
    expect(saved.sections).toEqual(["crew", "clips", "spots", "closet", "stats"]);
  });
});
