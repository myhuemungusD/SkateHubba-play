import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
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
    const { container } = render(<SpotlightVideo src="clip.webm" onNext={vi.fn()} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.autoplay).toBe(true);
    fireIntersect(video, true);
    expect(play).toHaveBeenCalled();
  });

  it("does not auto-play on scroll-in when reduced motion is on", () => {
    reducedMotion.value = true;
    const { container } = render(<SpotlightVideo src="clip.webm" onNext={vi.fn()} />);
    const video = container.querySelector("video") as HTMLVideoElement;
    expect(video.autoplay).toBe(false);
    // No IntersectionObserver is registered in reduced-motion mode.
    expect(ioCallback).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });

  it("starts playback via the overlay tap when paused (reduced-motion play affordance)", async () => {
    reducedMotion.value = true;
    // jsdom video elements report paused=true by default.
    render(<SpotlightVideo src="clip.webm" onNext={vi.fn()} />);
    await userEvent.click(screen.getByLabelText(/unmute clip/i));
    expect(play).toHaveBeenCalled();
  });
});
