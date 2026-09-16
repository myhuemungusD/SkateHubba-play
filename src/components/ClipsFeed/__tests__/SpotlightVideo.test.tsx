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

describe("SpotlightVideo playback failure", () => {
  it("RETRY clears the failure overlay and reloads the element", async () => {
    const user = userEvent.setup();
    const load = vi.spyOn(window.HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const { container } = render(<SpotlightVideo src="clip.webm" onNext={vi.fn()} />);
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

  it("keeps the failure overlay over the ended overlay and disables NEXT while advancing", () => {
    const { container } = render(<SpotlightVideo src="clip.webm" onNext={vi.fn()} advancing />);
    const video = container.querySelector("video") as HTMLVideoElement;
    fireEvent.ended(video);
    fireEvent.error(video);
    expect(screen.queryByText(/clip ended/i)).not.toBeInTheDocument();
    const next = screen.getByRole("button", { name: /next trick/i });
    expect(next).toBeDisabled();
    expect(next).toHaveTextContent("LOADING…");
  });
});
