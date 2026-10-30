import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../../../components/UserClipUpload", () => ({
  UserClipUploadModal: (p: {
    initialClip?: { videoUrl: string; trickName: string };
    editFirst?: boolean;
    onClose: () => void;
    onPosted: () => void;
  }) => (
    <div data-testid="editor-modal" data-url={p.initialClip?.videoUrl} data-edit-first={String(p.editFirst)}>
      <button type="button" onClick={p.onClose}>
        close
      </button>
      <button type="button" onClick={p.onPosted}>
        posted
      </button>
    </div>
  ),
}));

import { PinnedClips } from "../PinnedClips";

const clips = [{ id: "c1", trickName: "Kickflip", videoUrl: "https://v/1.mp4", thumbnailUrl: null }] as never;

describe("PinnedClips", () => {
  it("renders nothing with no clips", () => {
    const { container } = render(<PinnedClips clips={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("has no Edit button when viewing someone else's clips", () => {
    render(<PinnedClips clips={clips} />);
    expect(screen.queryByRole("button", { name: "Edit Kickflip" })).not.toBeInTheDocument();
  });

  it("opens your own clip in the editor flow from Edit, and closes it", async () => {
    render(<PinnedClips clips={clips} editor={{ uid: "me", username: "me" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Kickflip" }));
    const modal = await screen.findByTestId("editor-modal");
    expect(modal).toHaveAttribute("data-url", "https://v/1.mp4");
    expect(modal).toHaveAttribute("data-edit-first", "true");
    fireEvent.click(screen.getByText("close"));
    expect(screen.queryByTestId("editor-modal")).not.toBeInTheDocument();
  });

  it("closes the editor once the edited clip is posted", async () => {
    render(<PinnedClips clips={clips} editor={{ uid: "me", username: "me" }} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Kickflip" }));
    fireEvent.click(await screen.findByText("posted"));
    expect(screen.queryByTestId("editor-modal")).not.toBeInTheDocument();
  });
});
