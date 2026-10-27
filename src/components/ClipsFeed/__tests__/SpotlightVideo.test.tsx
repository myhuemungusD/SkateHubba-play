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
    expect(video).toHaveClass("object-contain");
    // The clip's own first frame, never the landing promo still.
    expect(video.getAttribute("poster")).toBeNull();
    expect(video.getAttribute("src")).toBe("clip.webm#t=0.1");
    expect(video.getAttribute("preload")).toBe("auto");
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
    expect(video.getAttribute("preload")).toBe("metadata");
    expect(video.getAttribute("poster")).toBeNull();
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

describe("SpotlightVideo playback state", () => {
  it("shows the play affordance again when the element pauses itself", () => {
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.play(video);
    expect(screen.getByRole("button", { name: /pause clip/i })).toBeInTheDocument();
    fireEvent.pause(video);
    expect(screen.getByRole("button", { name: /play clip/i })).toBeInTheDocument();
  });

  it("keeps the play affordance when a tap-to-play is refused", async () => {
    reducedMotion.value = true;
    play.mockRejectedValueOnce(new Error("NotAllowedError"));
    render(<SpotlightVideo src="clip.webm" />);
    await userEvent.click(screen.getByRole("button", { name: /play clip/i }));
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /play clip/i })).toBeInTheDocument();
  });

  it("RETRY reloads without auto-playing when reduced motion is on", async () => {
    reducedMotion.value = true;
    const load = vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    fireEvent.error(container.querySelector("video") as HTMLVideoElement);
    await userEvent.click(screen.getByRole("button", { name: /retry clip/i }));
    expect(load).toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    load.mockRestore();
  });

  it("hands mute to the parent when it owns the muted state", async () => {
    const onToggleMute = vi.fn();
    const { container } = render(<SpotlightVideo src="clip.webm" muted onToggleMute={onToggleMute} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    await userEvent.click(screen.getByRole("button", { name: /unmute clip/i }));
    expect(onToggleMute).toHaveBeenCalledTimes(1);
    // The parent hasn't flipped its prop, so the clip stays muted.
    expect(video.muted).toBe(true);
    expect(screen.getByRole("button", { name: /unmute clip/i })).toBeInTheDocument();
  });
});

describe("SpotlightVideo paging", () => {
  it.each([
    { outcome: "plays", settle: () => play.mockResolvedValueOnce(undefined), pauses: 1 },
    // A refused play() is swallowed; it never played, so there is nothing to pause.
    { outcome: "is refused", settle: () => play.mockRejectedValueOnce(new Error("NotAllowedError")), pauses: 0 },
  ])(
    "starts a slide as it becomes active and, when it $outcome, pauses on swipe-away $pauses time(s)",
    async ({ settle, pauses }) => {
      settle();
      const { container, rerender } = render(<SpotlightVideo src="clip.webm" active={false} />);
      const video = container.querySelector("video") as HTMLVideoElement;
      const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
      rerender(<SpotlightVideo src="clip.webm" active />);
      expect(play).toHaveBeenCalledTimes(1);
      await Promise.resolve();
      await Promise.resolve();
      rerender(<SpotlightVideo src="clip.webm" active={false} />);
      expect(pause).toHaveBeenCalledTimes(pauses);
    },
  );
});

describe("SpotlightVideo viewport observer", () => {
  it("pauses a clip on scroll-out only once it has actually played", async () => {
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
    // The activation play() hasn't resolved yet: nothing to pause.
    fireIntersect(video, false);
    expect(pause).not.toHaveBeenCalled();
    fireIntersect(video, true);
    await Promise.resolve();
    fireIntersect(video, false);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it("swallows a rejected play() on scroll-in and then has nothing to pause", async () => {
    play.mockRejectedValueOnce(new Error("NotAllowedError"));
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
    fireIntersect(video, true);
    expect(play).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    fireIntersect(video, false);
    expect(pause).not.toHaveBeenCalled();
  });

  it("does not resume on scroll-in after the viewer paused it", async () => {
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.play(video);
    await userEvent.click(screen.getByRole("button", { name: /pause clip/i }));
    expect(pause).toHaveBeenCalledTimes(1);
    play.mockClear();
    fireIntersect(video, true);
    expect(play).not.toHaveBeenCalled();
  });

  it("ignores an empty observer batch", () => {
    render(<SpotlightVideo src="clip.webm" />);
    play.mockClear();
    ioCallback!([], {} as IntersectionObserver);
    expect(play).not.toHaveBeenCalled();
  });

  it("falls back to the autoplay attribute where IntersectionObserver is unavailable", () => {
    // @ts-expect-error -- simulating an engine without IntersectionObserver
    delete globalThis.IntersectionObserver;
    const { container } = render(<SpotlightVideo src="clip.webm" />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.autoplay).toBe(true);
    expect(ioCallback).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
});
