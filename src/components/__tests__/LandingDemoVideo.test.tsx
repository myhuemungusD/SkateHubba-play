import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LandingDemoVideo, LANDING_VIDEO_POSTER, LANDING_VIDEO_SRC } from "../LandingDemoVideo";

const motion = vi.hoisted(() => ({ reduced: false }));
vi.mock("../../hooks/useReducedMotion", () => ({
  useReducedMotion: () => motion.reduced,
}));

// Drive the viewport callback by hand. Each constructed observer is recorded
// so a test can assert on observe/disconnect and fire entries at it.
interface FakeObserver {
  fire: (isIntersecting: boolean) => void;
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  options?: IntersectionObserverInit;
}
const observers: FakeObserver[] = [];
const realIO = globalThis.IntersectionObserver;

const mediaPlay = window.HTMLMediaElement.prototype.play as unknown as ReturnType<typeof vi.fn>;
const mediaPause = window.HTMLMediaElement.prototype.pause as unknown as ReturnType<typeof vi.fn>;

function installFakeIO() {
  globalThis.IntersectionObserver = vi.fn(function (
    this: unknown,
    cb: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    const o: FakeObserver = {
      observe: vi.fn(),
      disconnect: vi.fn(),
      options,
      fire: (isIntersecting) => cb([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver),
    };
    observers.push(o);
    return { observe: o.observe, disconnect: o.disconnect, unobserve: vi.fn(), takeRecords: () => [] };
  }) as unknown as typeof IntersectionObserver;
}

function getVideo() {
  return screen.getByTestId("landing-demo-video") as HTMLVideoElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  motion.reduced = false;
  observers.length = 0;
  installFakeIO();
});

afterEach(() => {
  globalThis.IntersectionObserver = realIO;
});

describe("LandingDemoVideo", () => {
  it("renders a lazy, muted, inline video with a poster and no autoplay", () => {
    render(<LandingDemoVideo />);
    const video = getVideo();
    expect(video.getAttribute("preload")).toBe("none");
    expect(video.getAttribute("poster")).toBe(LANDING_VIDEO_POSTER);
    expect(video.autoplay).toBe(false);
    expect(video.muted).toBe(true);
    expect(video.hasAttribute("playsinline")).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.querySelector("source")?.getAttribute("src")).toBe(LANDING_VIDEO_SRC);
    expect(mediaPlay).not.toHaveBeenCalled();
  });

  it("plays when scrolled into view and pauses when scrolled out", () => {
    render(<LandingDemoVideo />);
    const video = getVideo();
    expect(observers).toHaveLength(1);
    expect(observers[0].observe).toHaveBeenCalledWith(video);
    expect(observers[0].options?.threshold).toBe(0.25);

    observers[0].fire(true);
    expect(mediaPlay).toHaveBeenCalledTimes(1);

    // jsdom reports paused=true by default; flip it so the pause branch runs.
    Object.defineProperty(video, "paused", { configurable: true, value: false });
    observers[0].fire(false);
    expect(mediaPause).toHaveBeenCalledTimes(1);
  });

  it("does not call pause when leaving the viewport while already paused", () => {
    render(<LandingDemoVideo />);
    observers[0].fire(false);
    expect(mediaPause).not.toHaveBeenCalled();
  });

  it("ignores an empty entry list", () => {
    render(<LandingDemoVideo />);
    const cb = (globalThis.IntersectionObserver as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as IntersectionObserverCallback;
    cb([], {} as IntersectionObserver);
    expect(mediaPlay).not.toHaveBeenCalled();
    expect(mediaPause).not.toHaveBeenCalled();
  });

  it("swallows a rejected play() (autoplay blocked) and keeps the poster", async () => {
    mediaPlay.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    render(<LandingDemoVideo />);
    observers[0].fire(true);
    await Promise.resolve();
    expect(getVideo().getAttribute("poster")).toBe(LANDING_VIDEO_POSTER);
  });

  it("shows only the poster under prefers-reduced-motion", () => {
    motion.reduced = true;
    render(<LandingDemoVideo />);
    expect(observers).toHaveLength(0);
    expect(mediaPlay).not.toHaveBeenCalled();
    expect(getVideo().getAttribute("poster")).toBe(LANDING_VIDEO_POSTER);
  });

  it("falls back to a direct play() when IntersectionObserver is unavailable", () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = undefined;
    render(<LandingDemoVideo />);
    expect(mediaPlay).toHaveBeenCalledTimes(1);
  });

  it("disconnects the observer and pauses on unmount", () => {
    const { unmount } = render(<LandingDemoVideo />);
    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
    expect(mediaPause).toHaveBeenCalled();
  });
});
