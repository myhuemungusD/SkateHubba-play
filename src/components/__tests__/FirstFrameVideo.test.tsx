import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("../../lib/sentry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/sentry")>()),
  captureException,
}));

import { CLIP_UNPLAYABLE_MESSAGE, FirstFrameVideo } from "../FirstFrameVideo";
import { CLIP_PLACEHOLDER, FIRST_FRAME_SECONDS } from "../../lib/clipPoster";

// Real download URLs carry a Storage access token.
const URL = "https://firebasestorage.googleapis.com/v0/b/x/o/clip.webm?alt=media&token=secret-token";

/** Fire a media error carrying a MediaError-like object. */
function failWith(video: HTMLElement, code?: number) {
  Object.defineProperty(video, "error", {
    configurable: true,
    value: code === undefined ? null : { code, message: `code ${code}` },
  });
  fireEvent.error(video);
}

describe("FirstFrameVideo", () => {
  beforeEach(() => captureException.mockClear());

  it("plays the clip from its own first frame with no poster", () => {
    render(<FirstFrameVideo src={URL} controls playsInline aria-label="Set clip" className="trick-frame" />);
    const video = screen.getByLabelText("Set clip");
    expect(video.tagName).toBe("VIDEO");
    expect(video).toHaveAttribute("src", `${URL}#t=${FIRST_FRAME_SECONDS}`);
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).not.toHaveAttribute("poster");
    expect(video).toHaveClass("trick-frame");
  });

  it("forwards the ref to the video element", () => {
    const ref = createRef<HTMLVideoElement>();
    render(<FirstFrameVideo ref={ref} src={URL} aria-label="Clip" />);
    expect(ref.current).toBe(screen.getByLabelText("Clip"));
  });

  it("seeks to the first frame when metadata loads and the player is parked at 0", () => {
    const onLoadedMetadata = vi.fn();
    render(<FirstFrameVideo src="blob:local" aria-label="Preview" onLoadedMetadata={onLoadedMetadata} />);
    const video = screen.getByLabelText("Preview") as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(FIRST_FRAME_SECONDS);
    expect(onLoadedMetadata).toHaveBeenCalledOnce();
  });

  it("leaves a playing or already-seeked player alone", () => {
    render(<FirstFrameVideo src="blob:local" aria-label="Preview" />);
    const video = screen.getByLabelText("Preview") as HTMLVideoElement;
    video.currentTime = 2;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(2);

    video.currentTime = 0;
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);
  });

  it("shows the neutral placeholder, not a black box, when the device can't decode the clip", () => {
    const onError = vi.fn();
    render(<FirstFrameVideo src={URL} controls aria-label="Set clip" className="trick-frame" onError={onError} />);
    failWith(screen.getByLabelText("Set clip"), 4);

    expect(document.querySelector("video")).toBeNull();
    const fallback = screen.getByRole("img", { name: "Set clip (can't play)" });
    expect(fallback).toHaveClass("trick-frame");
    expect(fallback.querySelector("img")).toHaveAttribute("src", CLIP_PLACEHOLDER);
    expect(screen.getByText(CLIP_UNPLAYABLE_MESSAGE)).toBeInTheDocument();
    // Code 4 also covers expired or deleted clips, so the copy blames nothing.
    expect(screen.queryByText(/iOS|device|try again/i)).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: expect.objectContaining({ context: "FirstFrameVideo", code: 4 }) }),
    );
    // The token-bearing download URL never reaches Sentry.
    expect(JSON.stringify(captureException.mock.calls)).not.toMatch(/secret-token|firebasestorage/);
  });

  it("uses the same neutral message for other errors and a generic label when unlabelled", () => {
    render(<FirstFrameVideo src={URL} errorContext="GameReplay" />);
    failWith(document.querySelector("video")!);
    expect(screen.getByRole("img", { name: "Clip can't play" })).toBeInTheDocument();
    expect(screen.getByText("This clip can't be played right now.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ extra: expect.objectContaining({ context: "GameReplay" }) }),
    );
  });

  it("gives a new clip a fresh try after a failure", () => {
    const { rerender } = render(<FirstFrameVideo src={URL} aria-label="Clip" />);
    failWith(screen.getByLabelText("Clip"), 4);
    expect(document.querySelector("video")).toBeNull();

    rerender(<FirstFrameVideo src={`${URL}-next`} aria-label="Clip" />);
    expect(screen.getByLabelText("Clip").tagName).toBe("VIDEO");
  });
});
