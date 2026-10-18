import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  createChallenge: vi.fn(),
  listChallenges: vi.fn(),
  listEntries: vi.fn(),
  setEntryFeatured: vi.fn(),
  giveProps: vi.fn(),
  listFeaturedClips: vi.fn(),
  featureClip: vi.fn(),
  unfeatureClip: vi.fn(),
}));
vi.mock("../../../services/proCommunity", () => ({
  ...h,
  MAX_FEATURED_PER_PRO: 3,
  PROP_STICKERS: ["fire", "steez"],
}));

import { FeaturedClipsTool, ProChallengesTool, ProPropsTool } from "../ProCommunityTools";

const pro = { uid: "p", username: "mike" };
beforeEach(() => {
  vi.clearAllMocks();
  h.listChallenges.mockResolvedValue([]);
  h.listEntries.mockResolvedValue([]);
  h.listFeaturedClips.mockResolvedValue([]);
});

describe("ProChallengesTool", () => {
  it("posts a challenge and features a make on it", async () => {
    h.listChallenges.mockResolvedValue([
      { id: "c1", proUid: "p", proUsername: "mike", trickName: "kickflip", description: "" },
      { id: "c2", proUid: "other", proUsername: "x", trickName: "heel", description: "" },
    ]);
    h.listEntries
      .mockResolvedValueOnce([
        { id: "e1", challengeId: "c1", uid: "u", username: "kid", clipId: "x", featured: false },
        { id: "e2", challengeId: "c1", uid: "v", username: "kid2", clipId: "y", featured: true },
      ])
      .mockResolvedValue([]);
    h.createChallenge.mockResolvedValue("c3");
    h.setEntryFeatured.mockResolvedValue(undefined);
    render(<ProChallengesTool pro={pro} />);
    expect(await screen.findByText("kickflip")).toBeInTheDocument();
    expect(screen.queryByText("heel")).toBeNull();
    expect(await screen.findByText(/kid2 · featured/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Feature" }));
    expect(await screen.findByText("No makes yet.")).toBeInTheDocument();
    expect(h.setEntryFeatured).toHaveBeenCalledWith("e1", true);
    fireEvent.change(screen.getByLabelText("Trick"), { target: { value: "tre" } });
    fireEvent.change(screen.getByLabelText("Details"), { target: { value: "flat" } });
    fireEvent.click(screen.getByRole("button", { name: "POST CHALLENGE" }));
    expect(await screen.findByText("Challenge posted.")).toBeInTheDocument();
    expect(h.createChallenge).toHaveBeenCalledWith(pro, "tre", "flat");
  });
  it("shows post and feature errors", async () => {
    h.listChallenges.mockResolvedValue([
      { id: "c1", proUid: "p", proUsername: "mike", trickName: "kf", description: "" },
    ]);
    h.listEntries.mockResolvedValue([
      { id: "e2", challengeId: "c1", uid: "v", username: "kid2", clipId: "y", featured: true },
    ]);
    h.setEntryFeatured.mockRejectedValue(new Error("x"));
    h.createChallenge.mockRejectedValueOnce(new Error("Name the trick")).mockRejectedValueOnce({});
    render(<ProChallengesTool pro={pro} />);
    fireEvent.click(await screen.findByRole("button", { name: "Unfeature" }));
    expect(await screen.findByText("Couldn't update that make.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "POST CHALLENGE" }));
    expect(await screen.findByText("Name the trick")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "POST CHALLENGE" }));
    expect(await screen.findByText("Couldn't post that challenge.")).toBeInTheDocument();
  });
  it("shows a loading state for makes", async () => {
    h.listChallenges.mockResolvedValue([
      { id: "c1", proUid: "p", proUsername: "mike", trickName: "kf", description: "" },
    ]);
    h.listEntries.mockReturnValue(new Promise(() => {}));
    render(<ProChallengesTool pro={pro} />);
    expect(await screen.findByText("Loading makes…")).toBeInTheDocument();
  });
});

describe("ProPropsTool", () => {
  it("sends props and reports errors", async () => {
    h.giveProps.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("No skater with that username."));
    render(<ProPropsTool pro={pro} />);
    fireEvent.change(screen.getByLabelText("Skater username"), { target: { value: "@kid" } });
    fireEvent.change(screen.getByLabelText("Sticker"), { target: { value: "steez" } });
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "sick" } });
    fireEvent.click(screen.getByRole("button", { name: "GIVE PROPS" }));
    expect(await screen.findByText("Props sent to @kid.")).toBeInTheDocument();
    expect(h.giveProps).toHaveBeenCalledWith(pro, "@kid", "steez", "sick");
    fireEvent.click(screen.getByRole("button", { name: "GIVE PROPS" }));
    expect(await screen.findByText("No skater with that username.")).toBeInTheDocument();
  });
});

describe("FeaturedClipsTool", () => {
  it("features, lists and unpins my clips", async () => {
    h.listFeaturedClips.mockResolvedValueOnce([]).mockResolvedValue([
      { clipId: "c1", proUid: "p", proUsername: "mike", videoUrl: null, trickName: "" },
      { clipId: "c2", proUid: "p", proUsername: "mike", videoUrl: null, trickName: "kf" },
      { clipId: "c3", proUid: "x", proUsername: "x", videoUrl: null, trickName: "other" },
    ]);
    h.featureClip.mockResolvedValue(undefined);
    h.unfeatureClip.mockRejectedValue(new Error(""));
    render(<FeaturedClipsTool pro={pro} />);
    fireEvent.change(screen.getByLabelText("Clip id"), { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "FEATURE" }));
    expect(await screen.findByText("kf")).toBeInTheDocument();
    expect(screen.getByText("c1")).toBeInTheDocument();
    expect(screen.queryByText("other")).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Unpin" })[0]);
    expect(await screen.findByText("Couldn't unpin that clip.")).toBeInTheDocument();
  });
});
