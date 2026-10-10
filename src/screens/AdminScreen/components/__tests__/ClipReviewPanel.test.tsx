import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deferred } from "../../../../__tests__/harness/deferred";
import { renderWithToasts } from "./adminPanels.test-helpers";

const fetchClipsInReview = vi.fn();
const decideClipModeration = vi.fn();

vi.mock("../../../../services/clipModeration", () => ({
  fetchClipsInReview: (...args: unknown[]) => fetchClipsInReview(...args),
  decideClipModeration: (...args: unknown[]) => decideClipModeration(...args),
}));

import { ClipReviewPanel } from "../ClipReviewPanel";

const clip = {
  id: "c1",
  trickName: "kickflip",
  playerUid: "u1",
  playerUsername: "ada",
  videoUrl: "https://example.com/clip.webm",
  explicitLikelihood: "POSSIBLE",
  skateDetected: false,
  skateLabels: [] as string[],
  reportReasons: ["not_skating"],
  grounds: "no skateboard detected",
};

beforeEach(() => {
  vi.clearAllMocks();
  fetchClipsInReview.mockResolvedValue([]);
  decideClipModeration.mockResolvedValue(undefined);
});

describe("ClipReviewPanel", () => {
  it("shows an empty queue", async () => {
    renderWithToasts(<ClipReviewPanel />);
    expect(await screen.findByTestId("clip-review-empty")).toBeInTheDocument();
  });

  it("shows a load error", async () => {
    fetchClipsInReview.mockRejectedValue(new Error("offline"));
    renderWithToasts(<ClipReviewPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("offline");
  });

  it("keeps a clip and removes one after a reason", async () => {
    const user = userEvent.setup();
    fetchClipsInReview.mockResolvedValue([
      clip,
      { ...clip, id: "c2", skateDetected: true, skateLabels: ["skateboard"], reportReasons: [], grounds: "" },
    ]);
    renderWithToasts(<ClipReviewPanel />);

    expect(await screen.findByTestId("review-c1")).toHaveTextContent("no skateboard");
    expect(screen.getByTestId("review-c1")).toHaveTextContent("not_skating");
    expect(screen.getByTestId("review-c2")).toHaveTextContent("skate: skateboard");
    expect(screen.getByTestId("review-c2")).toHaveTextContent("Reports: none");

    expect(screen.getAllByRole("button", { name: "Remove" })[0]).toBeDisabled();

    const keeping = deferred<void>();
    decideClipModeration.mockReturnValueOnce(keeping.promise);
    await user.click(screen.getAllByRole("button", { name: "Keep" })[0]!);
    expect(screen.getAllByRole("button", { name: "Keep" })[0]).toBeDisabled();
    keeping.resolve();
    await waitFor(() => expect(decideClipModeration).toHaveBeenCalledWith("c1", "approved", ""));
    expect(await screen.findByText(/stays up/)).toBeInTheDocument();

    await user.type(screen.getAllByLabelText("Reason for removal")[1]!, "not skating");
    await user.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    await waitFor(() => expect(decideClipModeration).toHaveBeenCalledWith("c2", "removed", "not skating"));
  });

  it("surfaces a failed decision and reloads", async () => {
    const user = userEvent.setup();
    const pending = deferred<unknown[]>();
    fetchClipsInReview.mockReturnValueOnce(pending.promise).mockResolvedValue([clip]);
    decideClipModeration.mockRejectedValueOnce(new Error("nope"));
    renderWithToasts(<ClipReviewPanel />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    pending.resolve([clip]);
    expect(await screen.findByTestId("review-c1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh clips" }));
    await waitFor(() => expect(fetchClipsInReview).toHaveBeenCalledTimes(2));
  });
});
