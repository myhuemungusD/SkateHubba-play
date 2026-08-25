import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClipComments } from "../ClipComments";
import { makeGameClip } from "../../__tests__/clipFixtures.test-helpers";
import { clipCommentsMocks, makeClipComment as comment, resetClipCommentsMocks } from "./clipComments.test-helpers";

vi.mock("../../../services/clips.comments", async () =>
  (await import("./clipComments.test-helpers")).clipCommentsModuleMock(),
);
vi.mock("../../../services/logger", async () => (await import("./clipComments.test-helpers")).loggerModuleMock());

const { fetch: mockFetch, create: mockCreate, remove: mockDelete } = clipCommentsMocks;

const clip = makeGameClip({ id: "c1", videoUrl: "https://cdn/x.webm" });

function renderSheet(viewerUid = "me", onClose = vi.fn()) {
  render(<ClipComments clip={clip} viewerUid={viewerUid} viewerUsername="viewer" onClose={onClose} />);
  return { onClose };
}

beforeEach(resetClipCommentsMocks);

describe("ClipComments", () => {
  it("loads the thread for the clip it was opened on", async () => {
    mockFetch.mockResolvedValueOnce({ comments: [comment()], cursor: null });
    renderSheet();

    expect(await screen.findByText("Clean.")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("c1");
  });

  it("shows an empty state when nobody has commented", async () => {
    renderSheet();
    expect(await screen.findByTestId("comments-empty")).toBeInTheDocument();
  });

  it("surfaces a load failure instead of an empty thread", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    renderSheet();
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't load comments/i);
  });

  it("posts a comment and prepends it to the newest-first thread", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ comments: [comment({ id: "old", text: "First." })], cursor: null });
    mockCreate.mockResolvedValueOnce(comment({ id: "new", userId: "me", username: "viewer", text: "Sick." }));
    renderSheet();
    await screen.findByText("First.");

    await user.type(screen.getByLabelText(/add a comment/i), "Sick.");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(mockCreate).toHaveBeenCalledWith("me", "viewer", "c1", "Sick."));
    const texts = screen.getAllByText(/Sick\.|First\./).map((n) => n.textContent);
    expect(texts).toEqual(["Sick.", "First."]);
  });

  it("clears the composer after a successful post", async () => {
    const user = userEvent.setup();
    mockCreate.mockResolvedValueOnce(comment({ id: "new", userId: "me", text: "Sick." }));
    renderSheet();
    await screen.findByTestId("comments-empty");

    const box = screen.getByLabelText(/add a comment/i);
    await user.type(box, "Sick.");
    await user.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("caps the composer at 300 characters and counts what's used", async () => {
    const user = userEvent.setup();
    renderSheet();
    await screen.findByTestId("comments-empty");

    const box = screen.getByLabelText(/add a comment/i);
    expect(box).toHaveAttribute("maxLength", "300");

    await user.type(box, "hello");
    expect(screen.getByTestId("comment-count-indicator")).toHaveTextContent("5/300");
  });

  it("refuses to post whitespace", async () => {
    const user = userEvent.setup();
    renderSheet();
    await screen.findByTestId("comments-empty");

    await user.type(screen.getByLabelText(/add a comment/i), "    ");

    expect(screen.getByRole("button", { name: "Post" })).toBeDisabled();
  });

  it("surfaces a post failure and keeps the draft", async () => {
    const user = userEvent.setup();
    mockCreate.mockRejectedValueOnce(new Error("Comments are limited to 300 characters."));
    renderSheet();
    await screen.findByTestId("comments-empty");

    await user.type(screen.getByLabelText(/add a comment/i), "Sick.");
    await user.click(screen.getByRole("button", { name: "Post" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/limited to 300/i);
    expect(screen.getByLabelText(/add a comment/i)).toHaveValue("Sick.");
  });

  it("offers delete only on the viewer's own comment", async () => {
    mockFetch.mockResolvedValueOnce({
      comments: [comment({ id: "mine", userId: "me", username: "viewer", text: "Mine." }), comment()],
      cursor: null,
    });
    renderSheet();
    await screen.findByText("Mine.");

    // One delete control for two comments — the author's.
    expect(screen.getAllByRole("button", { name: /delete your comment/i })).toHaveLength(1);
  });

  it("removes the comment from the thread once the delete lands", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      comments: [comment({ id: "mine", userId: "me", username: "viewer", text: "Mine." })],
      cursor: null,
    });
    mockDelete.mockResolvedValueOnce(undefined);
    renderSheet();
    await screen.findByText("Mine.");

    await user.click(screen.getByRole("button", { name: /delete your comment/i }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith("me", "c1", "mine"));
    await waitFor(() => expect(screen.queryByText("Mine.")).not.toBeInTheDocument());
  });

  it("keeps the comment and reports the failure when the delete is rejected", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      comments: [comment({ id: "mine", userId: "me", username: "viewer", text: "Mine." })],
      cursor: null,
    });
    mockDelete.mockRejectedValueOnce(new Error("permission-denied"));
    renderSheet();
    await screen.findByText("Mine.");

    await user.click(screen.getByRole("button", { name: /delete your comment/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't delete/i);
    expect(screen.getByText("Mine.")).toBeInTheDocument();
  });

  it("closes on the CLOSE control and on Escape", async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await screen.findByTestId("comments-empty");

    await user.click(screen.getByRole("button", { name: /close comments/i }));
    expect(onClose).toHaveBeenCalledTimes(1);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
