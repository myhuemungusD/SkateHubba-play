import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SpotlightVideo } from "../SpotlightVideo";

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("../../../hooks/useReducedMotion", () => ({
  useReducedMotion: () => reducedMotion.value,
}));

// Controllable IntersectionObserver so we can drive the in-viewport callback.
// Restored after each test so we don't leak it into the shared global stub.
type IOCallback = ConstructorParameters<typeof IntersectionObserver>[0];
let ioCallback: IOCallback | null = null;
const originalIO = globalThis.IntersectionObserver;

// The global HTMLMediaElement.play mock from setup.ts resolves to a promise;
// reference it directly rather than spying so we don't tear down the shared
// stub other suites rely on. clearAllMocks resets call history per-test.
const play = window.HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  reducedMotion.value = false;
  ioCallback = null;
  globalThis.IntersectionObserver = class {
    constructor(cb: IOCallback) {
      ioCallback = cb;
    }
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
  } as unknown as typeof IntersectionObserver;
});

afterEach(() => {
  globalThis.IntersectionObserver = originalIO;
});

function fireIntersect(video: HTMLVideoElement, isIntersecting: boolean) {
  const entry = { isIntersecting, target: video } as unknown as IntersectionObserverEntry;
  ioCallback!([entry], {} as IntersectionObserver);
}

describe("SpotlightVideo reduced motion", () => {
  it("auto-plays on scroll-in when reduced motion is off", () => {
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.autoplay).toBe(true);
    fireIntersect(video, true);
    expect(play).toHaveBeenCalled();
  });

  it("does not auto-play on scroll-in when reduced motion is on", () => {
    reducedMotion.value = true;
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.autoplay).toBe(false);
    // No IntersectionObserver is registered in reduced-motion mode.
    expect(ioCallback).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("starts playback via the play button when paused (reduced-motion play affordance)", async () => {
    reducedMotion.value = true;
    // jsdom video elements report paused=true by default.
    render(<SpotlightVideo src="clip.webm" />);
    await userEvent.click(screen.getByRole("button", { name: /play clip/i }));
    expect(play).toHaveBeenCalled();
  });

  it("loops and does not autoplay a slide that is not the active page", () => {
    const { container } = render(<SpotlightVideo src="clip.webm" active={false} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.loop).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(ioCallback).toBeNull();
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /play clip/i })).not.toBeInTheDocument();
  });
});

describe("SpotlightVideo playback failure", () => {
  it("RETRY clears the failure overlay and reloads the element", async () => {
    const user = userEvent.setup();
    const load = vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;

    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn't play this clip/i);

    // A rejected play() (autoplay policy, still-dead network) must not throw
    // out of the click handler — the element's next `error` event re-raises
    // the overlay instead.
    play.mockRejectedValueOnce(new Error("NotAllowedError"));
    await user.click(screen.getByRole("button", { name: /retry clip/i }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(load).toHaveBeenCalled();
    expect(play).toHaveBeenCalled();
    load.mockRestore();
  });

  it("offers retry without a next-trick control — moving on is a swipe", () => {
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.error(video);
    expect(screen.getByRole("button", { name: /retry clip/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /next trick/i })).not.toBeInTheDocument();
    expect(video.loop).toBe(true);
  });

  it("toggles mute from its own control and pauses when the video is tapped", async () => {
    const user = userEvent.setup();
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.play(video);

    await user.click(screen.getByRole("button", { name: /unmute clip/i }));
    expect(screen.getByRole("button", { name: /mute clip/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /pause clip/i }));
    expect(pause).toHaveBeenCalled();
  });
});
