import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ queue: vi.fn(), gold: vi.fn(), call: vi.fn(), mark: vi.fn() }));
vi.mock("../../../services/proCalls", () => ({
  fetchProQueue: h.queue,
  fetchGoldCandidates: h.gold,
  submitProCall: h.call,
  submitGoldClip: h.mark,
}));

import { GoldClipAuthoring, ProReviewQueue } from "../ProCallsTools";

beforeEach(() => vi.clearAllMocks());

describe("ProCallsTools", () => {
  it("lets a pro make the call on a split vote", async () => {
    h.queue.mockResolvedValue([
      { clipId: "c1", options: ["kickflip", "heelflip"], videoUrl: "v", voteCount: 4 },
      { clipId: "c2", options: ["shuvit"], videoUrl: null, voteCount: 0 },
    ]);
    h.call.mockResolvedValue(undefined);
    render(<ProReviewQueue uid="p" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "heelflip" }));
    expect(await screen.findByText("Your call: heelflip")).toBeInTheDocument();
    expect(h.call).toHaveBeenCalledWith("c1", "p", "heelflip");
    expect(screen.getAllByLabelText(/Clip c/)).toHaveLength(1);
  });

  it("shows an error when a call fails and an empty state", async () => {
    h.gold.mockResolvedValue([{ clipId: "c1", options: ["kickflip"], videoUrl: null, voteCount: 0 }]);
    h.mark.mockRejectedValue(new Error("exists"));
    render(<GoldClipAuthoring uid="p" />);
    fireEvent.click(await screen.findByRole("button", { name: "kickflip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("didn't save");
    h.queue.mockResolvedValue([]);
    render(<ProReviewQueue uid="p" />);
    expect(await screen.findByText("No split votes waiting. Nice.")).toBeInTheDocument();
  });

  it("ignores results after unmount", async () => {
    let done: (v: unknown) => void = () => {};
    h.gold.mockReturnValue(new Promise((r) => (done = r)));
    render(<GoldClipAuthoring uid="p" />).unmount();
    done([]);
    await Promise.resolve();
  });
});
