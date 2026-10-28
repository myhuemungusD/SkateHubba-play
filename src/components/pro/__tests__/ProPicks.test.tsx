import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  listFeaturedClips: vi.fn(),
  listChallenges: vi.fn(),
  listPropsFor: vi.fn(),
  enterChallenge: vi.fn(),
  fetchPinnableClips: vi.fn(),
}));
vi.mock("../../../services/proCommunity", () => ({
  listFeaturedClips: h.listFeaturedClips,
  listChallenges: h.listChallenges,
  listPropsFor: h.listPropsFor,
  enterChallenge: h.enterChallenge,
}));
vi.mock("../../../services/profileCustom", () => ({ fetchPinnableClips: h.fetchPinnableClips }));

import { PropsRow, ProPicks } from "../ProPicks";

const player = { uid: "u", username: "kid" };
beforeEach(() => {
  vi.clearAllMocks();
  h.listFeaturedClips.mockResolvedValue([]);
  h.listChallenges.mockResolvedValue([]);
  h.fetchPinnableClips.mockResolvedValue([]);
});

describe("ProPicks", () => {
  it("opens to featured clips and lets a player enter a challenge", async () => {
    h.listFeaturedClips.mockResolvedValue([
      { clipId: "f1", proUid: "p", proUsername: "mike", videoUrl: "v", trickName: "kf", userClip: true },
      { clipId: "f2", proUid: "p", proUsername: "mike", videoUrl: null, trickName: "", userClip: true },
      // No trick name: the player still gets a labelled video (falls back to the clip id).
      { clipId: "f3", proUid: "p", proUsername: "mike", videoUrl: "w", trickName: "", userClip: true },
      // A featured game clip stays off Pro Picks: the feed shows user posts only.
      { clipId: "f4", proUid: "p", proUsername: "mike", videoUrl: "g", trickName: "game turn", userClip: false },
    ]);
    h.listChallenges.mockResolvedValue([
      { id: "c1", proUid: "p", proUsername: "mike", trickName: "tre", description: "flat ground" },
      { id: "c2", proUid: "p", proUsername: "mike", trickName: "heel", description: "" },
    ]);
    h.fetchPinnableClips.mockResolvedValue([{ id: "m1", trickName: "my tre", videoUrl: "x", thumbnailUrl: null }]);
    h.enterChallenge.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("dup"));
    render(<ProPicks player={player} />);
    fireEvent.click(screen.getByRole("button", { name: /PRO PICKS/ }));
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByLabelText("kf")).toBeInTheDocument();
    expect(screen.getByLabelText("f3").tagName).toBe("VIDEO");
    expect(screen.queryByLabelText("game turn")).not.toBeInTheDocument();
    expect(screen.getByText("flat ground")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Your clip for tre"), { target: { value: "m1" } });
    fireEvent.click(screen.getAllByRole("button", { name: "ENTER" })[0]);
    expect(await screen.findByText("Make sent. Good luck.")).toBeInTheDocument();
    expect(h.enterChallenge).toHaveBeenCalledWith("c1", player, "m1");
    fireEvent.change(screen.getByLabelText("Your clip for heel"), { target: { value: "m1" } });
    fireEvent.click(screen.getByRole("button", { name: "ENTER" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't enter");
    fireEvent.click(screen.getByRole("button", { name: /PRO PICKS/ }));
    fireEvent.click(screen.getByRole("button", { name: /PRO PICKS/ }));
    expect(h.listFeaturedClips).toHaveBeenCalledTimes(1);
  });
  it("shows empty states and asks for a clip when the player has none", async () => {
    render(<ProPicks player={player} />);
    fireEvent.click(screen.getByRole("button", { name: /PRO PICKS/ }));
    expect(await screen.findByText("No pro picks yet.")).toBeInTheDocument();
    expect(screen.getByText("No open challenges.")).toBeInTheDocument();
  });
  it("needs a clip to enter, and ignores late loads", async () => {
    h.listChallenges.mockResolvedValue([
      { id: "c1", proUid: "p", proUsername: "mike", trickName: "tre", description: "" },
    ]);
    const { unmount } = render(<ProPicks player={player} />);
    fireEvent.click(screen.getByRole("button", { name: /PRO PICKS/ }));
    expect(await screen.findByText("Post a clip of it to enter.")).toBeInTheDocument();
    unmount();
    let done: (v: unknown) => void = () => {};
    h.listFeaturedClips.mockReturnValue(new Promise((r) => (done = r)));
    const r2 = render(<ProPicks player={player} />);
    fireEvent.click(screen.getByRole("button", { name: /PRO PICKS/ }));
    r2.unmount();
    done([]);
    await Promise.resolve();
  });
});

describe("PropsRow", () => {
  it("renders props, nothing when empty, and ignores late loads", async () => {
    h.listPropsFor.mockResolvedValueOnce([
      { id: "x", fromUid: "p", fromUsername: "mike", toUid: "u", toUsername: "kid", sticker: "fire", note: "sick" },
    ]);
    render(<PropsRow uid="u" />);
    expect(await screen.findByText("fire · @mike")).toBeInTheDocument();
    h.listPropsFor.mockResolvedValueOnce([]);
    const { container } = render(<PropsRow uid="v" />);
    await Promise.resolve();
    expect(container).toBeEmptyDOMElement();
    let done: (v: unknown) => void = () => {};
    h.listPropsFor.mockReturnValueOnce(new Promise((r) => (done = r)));
    render(<PropsRow uid="w" />).unmount();
    done([]);
    await Promise.resolve();
  });
});
