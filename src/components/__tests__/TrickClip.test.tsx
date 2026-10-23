import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TrickClip } from "../TrickClip";

function setup() {
  render(<TrickClip src="https://example.test/clip.mp4" label="Kickflip clip" />);
  const video = screen.getByLabelText("Kickflip clip", { selector: "video" }) as HTMLVideoElement;
  return { video, frame: screen.getByTestId("trick-clip") };
}

function stubMedia(video: HTMLVideoElement, { duration = 10, paused = true } = {}) {
  let isPaused = paused;
  Object.defineProperty(video, "paused", { configurable: true, get: () => isPaused });
  Object.defineProperty(video, "duration", { configurable: true, value: duration });
  const play = vi.fn(() => {
    isPaused = false;
    fireEvent.play(video);
    return Promise.resolve();
  });
  const pause = vi.fn(() => {
    isPaused = true;
    fireEvent.pause(video);
  });
  video.play = play;
  video.pause = pause;
  return { play, pause };
}

describe("TrickClip", () => {
  it("renders without native controls or the download / PiP menu", () => {
    const { video } = setup();
    expect(video).not.toHaveAttribute("controls");
    expect(video).toHaveAttribute("disablepictureinpicture");
    expect(video.getAttribute("controlslist")).toContain("nodownload");
  });

  it("plays and pauses from the labelled button and from a tap on the frame", async () => {
    const { video } = setup();
    const { play, pause } = stubMedia(video);
    await userEvent.click(screen.getByRole("button", { name: "Play Kickflip clip" }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Pause Kickflip clip" })).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("trick-clip-tap"));
    expect(pause).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Play Kickflip clip" })).toBeInTheDocument();
  });

  it("falls back to Play when the browser blocks playback", async () => {
    const { video } = setup();
    Object.defineProperty(video, "paused", { configurable: true, get: () => true });
    video.play = vi.fn(() => Promise.reject(new Error("NotAllowedError")));
    await userEvent.click(screen.getByRole("button", { name: "Play Kickflip clip" }));
    expect(screen.getByRole("button", { name: "Play Kickflip clip" })).toBeInTheDocument();
  });

  it("shows Play again when the clip ends", () => {
    const { video } = setup();
    fireEvent.play(video);
    expect(screen.getByRole("button", { name: "Pause Kickflip clip" })).toBeInTheDocument();
    fireEvent.ended(video);
    expect(screen.getByRole("button", { name: "Play Kickflip clip" })).toBeInTheDocument();
  });

  it("toggles mute", async () => {
    const { video } = setup();
    const mute = screen.getByRole("button", { name: "Mute" });
    expect(mute).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(mute);
    expect(video.muted).toBe(true);
    expect(screen.getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
  });

  it("tracks progress and seeks with the scrubber", () => {
    const { video } = setup();
    stubMedia(video, { duration: 10 });
    video.currentTime = 2.5;
    fireEvent.timeUpdate(video);
    const seek = screen.getByRole("slider", { name: "Seek" }) as HTMLInputElement;
    expect(seek.value).toBe("25");
    fireEvent.change(seek, { target: { value: "50" } });
    expect(video.currentTime).toBe(5);
    expect(seek.value).toBe("50");
  });

  it("ignores progress and seeking before the duration is known", () => {
    const { video } = setup();
    stubMedia(video, { duration: Number.NaN });
    fireEvent.timeUpdate(video);
    const seek = screen.getByRole("slider", { name: "Seek" }) as HTMLInputElement;
    fireEvent.change(seek, { target: { value: "40" } });
    expect(seek.value).toBe("0");
  });

  it("takes the clip's own aspect ratio once metadata loads", () => {
    const { video, frame } = setup();
    expect(frame.style.getPropertyValue("--clip-aspect")).toBe("");
    Object.defineProperty(video, "videoWidth", { configurable: true, value: 1920 });
    Object.defineProperty(video, "videoHeight", { configurable: true, value: 1080 });
    fireEvent.loadedMetadata(video);
    expect(Number(frame.style.getPropertyValue("--clip-aspect"))).toBeCloseTo(16 / 9);
  });

  it("keeps the 9:16 default when metadata has no dimensions", () => {
    const { video, frame } = setup();
    fireEvent.loadedMetadata(video);
    expect(frame.style.getPropertyValue("--clip-aspect")).toBe("");
  });
});
