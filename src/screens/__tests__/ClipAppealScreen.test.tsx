import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deferred } from "../../__tests__/harness/deferred";

const loadClipAppeal = vi.fn();
const submitClipAppeal = vi.fn();

vi.mock("../../services/clipModeration", () => ({
  loadClipAppeal: (...args: unknown[]) => loadClipAppeal(...args),
  submitClipAppeal: (...args: unknown[]) => submitClipAppeal(...args),
}));

import { ClipAppealScreen } from "../ClipAppealScreen";

beforeEach(() => {
  vi.clearAllMocks();
  loadClipAppeal.mockResolvedValue({
    clipId: "c1",
    trickName: "c1",
    moderation: "removed",
    statement: "Too explicit.",
    canAppeal: true,
  });
  submitClipAppeal.mockResolvedValue(undefined);
});

describe("ClipAppealScreen", () => {
  it("shows the statement and sends an appeal", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const pending = deferred<unknown>();
    loadClipAppeal.mockReturnValueOnce(pending.promise);
    render(<ClipAppealScreen uid="me" statementId="clip_c1" onBack={onBack} />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    pending.resolve({
      clipId: "c1",
      trickName: "c1",
      moderation: "removed",
      statement: "Too explicit.",
      canAppeal: true,
    });

    expect(await screen.findByText("Too explicit.")).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Send appeal" });
    expect(send).toBeDisabled();
    await user.type(screen.getByLabelText("Why should this change?"), "It is skating.");
    const sending = deferred<void>();
    submitClipAppeal.mockReturnValueOnce(sending.promise);
    await user.click(send);
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    sending.resolve();
    await waitFor(() => expect(submitClipAppeal).toHaveBeenCalledWith("me", "clip_c1", "It is skating."));
    expect(await screen.findByText(/Appeal sent/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("shows a load error and a send error", async () => {
    const user = userEvent.setup();
    loadClipAppeal.mockRejectedValueOnce(new Error("That clip is gone."));
    const { unmount } = render(<ClipAppealScreen uid="me" statementId="clip_c1" onBack={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("That clip is gone.");
    unmount();

    loadClipAppeal.mockResolvedValue({
      clipId: "c1",
      trickName: "c1",
      moderation: "",
      statement: "",
      canAppeal: true,
    });
    submitClipAppeal.mockRejectedValueOnce("nope");
    render(<ClipAppealScreen uid="me" statementId="clip_c1" onBack={vi.fn()} />);
    expect(await screen.findByText("No statement was recorded.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Why should this change?"), "please");
    await user.click(screen.getByRole("button", { name: "Send appeal" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't send your appeal.");
  });

  it("hides the form when an appeal is not available", async () => {
    loadClipAppeal.mockResolvedValue({
      clipId: "c1",
      trickName: "c1",
      moderation: "",
      statement: "In review.",
      canAppeal: false,
    });
    render(<ClipAppealScreen uid="me" statementId="clip_c1" onBack={vi.fn()} />);
    expect(await screen.findByText("In review.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send appeal" })).not.toBeInTheDocument();
  });
});
