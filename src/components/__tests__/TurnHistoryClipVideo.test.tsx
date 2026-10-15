import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("../../lib/sentry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sentry")>()),
  captureException,
}));

import { ClipVideo } from "../TurnHistoryClipVideo";

const URL_OK = "https://firebasestorage.googleapis.com/v0/b/x/o/clip.mp4";

describe("ClipVideo", () => {
  it.each(["", "https://evil.example.com/clip.mp4"])("renders nothing for a non-storage url %j", (url) => {
    const { container } = render(<ClipVideo url={url} label="Set clip" />);
    expect(container.firstChild).toBeNull();
  });

  it("swaps to a placeholder and reports when playback fails", () => {
    render(<ClipVideo url={URL_OK} label="Set clip" />);
    fireEvent.error(screen.getByLabelText("Set clip"));
    expect(screen.getByText("Clip no longer available")).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: expect.objectContaining({ context: "ClipVideo", url: URL_OK, label: "Set clip" }),
    });
  });
});
