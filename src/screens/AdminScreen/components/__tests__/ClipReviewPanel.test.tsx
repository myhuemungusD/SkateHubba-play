import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
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

function page(clips: (typeof clip)[], cursor: { moderationUpdatedAtMs: number; id: string } | null = null) {
  return { clips, cursor };
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchClipsInReview.mockResolvedValue(page([]));
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
    fetchClipsInReview.mockResolvedValue(
      page([
        clip,
        { ...clip, id: "c2", skateDetected: true, skateLabels: ["skateboard"], reportReasons: [], grounds: "" },
      ]),
    );
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
    const pending = deferred<ReturnType<typeof page>>();
    fetchClipsInReview.mockReturnValueOnce(pending.promise).mockResolvedValue(page([clip]));
    decideClipModeration.mockRejectedValueOnce(new Error("nope"));
    renderWithToasts(<ClipReviewPanel />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    pending.resolve(page([clip]));
    expect(await screen.findByTestId("review-c1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(await screen.findByText("nope")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Refresh clips" }));
    await waitFor(() => expect(fetchClipsInReview).toHaveBeenCalledTimes(2));
  });

  it("loads the next page after the first", async () => {
    const user = userEvent.setup();
    const cursor = { moderationUpdatedAtMs: 10, id: "c1" };
    fetchClipsInReview.mockResolvedValueOnce(page([clip], cursor)).mockResolvedValueOnce(page([{ ...clip, id: "c2" }]));
    renderWithToasts(<ClipReviewPanel />);
    expect(await screen.findByTestId("review-c1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByTestId("review-c2")).toBeInTheDocument();
    expect(fetchClipsInReview).toHaveBeenLastCalledWith(cursor);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
  });

  it("labels a clip the screener saw a board in but named nothing for", async () => {
    fetchClipsInReview.mockResolvedValue(page([{ ...clip, skateDetected: true, skateLabels: [] }]));
    renderWithToasts(<ClipReviewPanel />);
    expect(await screen.findByTestId("review-c1")).toHaveTextContent("AI POSSIBLE · skate: yes");
  });

  it("keeps the loaded clips and shows the error when the next page fails", async () => {
    const user = userEvent.setup();
    const cursor = { moderationUpdatedAtMs: 10, id: "c1" };
    fetchClipsInReview.mockResolvedValueOnce(page([clip], cursor)).mockRejectedValueOnce(new Error("page down"));
    renderWithToasts(<ClipReviewPanel />);
    expect(await screen.findByTestId("review-c1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("page down");
    expect(screen.getByTestId("review-c1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
  });

  describe("when a newer reload overtakes an older one", () => {
    // Keep on one card reloads the queue; Keep on a second card before that
    // read lands starts a newer read. Whatever the older read brings back
    // must not replace what the newer one showed.
    async function overtake() {
      const user = userEvent.setup();
      const older = deferred<ReturnType<typeof page>>();
      const newer = deferred<ReturnType<typeof page>>();
      fetchClipsInReview
        .mockResolvedValueOnce(page([clip, { ...clip, id: "c2", playerUsername: "bo" }]))
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise);
      renderWithToasts(<ClipReviewPanel />);
      expect(await screen.findByTestId("review-c2")).toBeInTheDocument();
      const [keepFirst, keepSecond] = screen.getAllByRole("button", { name: "Keep" });
      await user.click(keepFirst);
      await waitFor(() => expect(fetchClipsInReview).toHaveBeenCalledTimes(2));
      await user.click(keepSecond);
      await waitFor(() => expect(fetchClipsInReview).toHaveBeenCalledTimes(3));
      await act(async () => newer.resolve(page([{ ...clip, id: "c9" }])));
      expect(await screen.findByTestId("review-c9")).toBeInTheDocument();
      return older;
    }

    it("ignores the older page when it lands", async () => {
      const older = await overtake();
      await act(async () => older.resolve(page([{ ...clip, id: "c5" }])));
      expect(screen.getByTestId("review-c9")).toBeInTheDocument();
      expect(screen.queryByTestId("review-c5")).not.toBeInTheDocument();
    });

    it("ignores the older failure when it lands", async () => {
      const older = await overtake();
      await act(async () => older.reject(new Error("stale failure")));
      expect(screen.getByTestId("review-c9")).toBeInTheDocument();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });
});
