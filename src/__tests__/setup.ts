import "@testing-library/jest-dom/vitest";

// Mock Firebase Messaging — jsdom lacks Service Worker and Push APIs required
// by the Firebase Messaging SDK, which throws "unsupported-browser" on init.
vi.mock("firebase/messaging", () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve(null)),
  onMessage: vi.fn(() => vi.fn()),
}));

// Mock navigator.mediaDevices with a fake stream so VideoRecorder enters
// preview state normally. The stream carries no real media, but each track
// mirrors the full MediaStreamTrack surface production code is entitled to
// assume: a real track ALWAYS has the event-target pair and getSettings().
// A thinner fake pushes defensive `typeof x === "function"` guards into
// production code purely to survive tests.
const mockStop = vi.fn();
function fakeTrack(kind: "video" | "audio") {
  return {
    stop: mockStop,
    kind,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getSettings: () => ({ frameRate: 30 }),
  };
}
const fakeVideoTrack = fakeTrack("video");
const fakeAudioTrack = fakeTrack("audio");
const mockStream = {
  getTracks: () => [fakeVideoTrack, fakeAudioTrack],
  getVideoTracks: () => [fakeVideoTrack],
  getAudioTracks: () => [fakeAudioTrack],
};
Object.defineProperty(globalThis.navigator, "mediaDevices", {
  writable: true,
  configurable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue(mockStream),
  },
});

// Stub MediaRecorder (not needed in demo mode, but prevents ReferenceError if accessed).
// `mimeType` is spec-guaranteed on every real instance and is what the capture
// hook reads to stamp the finished blob, so the fake reports one too.
class MockMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(false);
  mimeType = "video/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn().mockImplementation(function (this: MockMediaRecorder) {
    this.onstop?.();
  });
}
(globalThis as unknown as Record<string, unknown>).MediaRecorder = MockMediaRecorder;

// Mock HTMLMediaElement.play() — jsdom does not implement it.
Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});

// Mock HTMLMediaElement.pause() — jsdom does not implement it.
Object.defineProperty(window.HTMLMediaElement.prototype, "pause", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

// jsdom lacks IntersectionObserver — provide a no-op stub so any component
// (notably the onboarding SpotlightOverlay) that observes anchor elements
// mounts without throwing. Tests that need to drive intersection events
// install their own controllable stub on top of this default.
class MockIntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
}
(globalThis as unknown as Record<string, unknown>).IntersectionObserver = MockIntersectionObserver;
