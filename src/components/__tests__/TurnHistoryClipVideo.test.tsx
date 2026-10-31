import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("../../lib/sentry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sentry")>()),
  captureException,
}));

import { ClipVideo } from "../TurnHistoryClipVideo";

const URL_OK = "https://firebasestorage.googleapis.com/v0/b/x/o/clip.mp4";
// Real download URLs carry a Storage access token.
const TOKEN_URL = `${URL_OK}?alt=media&token=secret-token`;

describe("ClipVideo", () => {
  it.each(["", "https://evil.example.com/clip.mp4"])("renders nothing for a non-storage url %j", (url) => {
    const { container } = render(<ClipVideo url={url} label="Set clip" />);
    expect(container.firstChild).toBeNull();
  });

  it("swaps to a placeholder and reports when playback fails", () => {
    render(<ClipVideo url={TOKEN_URL} label="Set clip" />);
    fireEvent.error(screen.getByLabelText("Set clip"));
    expect(screen.getByText("Clip no longer available")).toBeInTheDocument();
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      extra: { context: "ClipVideo", label: "Set clip", mediaError: undefined },
    });
    // The token-bearing download URL never reaches Sentry.
    expect(JSON.stringify(captureException.mock.calls)).not.toMatch(/secret-token|firebasestorage/);
  });
});
