import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

// Firebase Messaging requires Service Worker + Push APIs that jsdom does not
// provide; without this mock, getMessaging() throws "unsupported-browser" at
// import time for any test that loads src/services/fcm.ts.
vi.mock("firebase/messaging", () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve(null)),
  onMessage: vi.fn(() => vi.fn()),
}));

// jsdom does not implement getUserMedia, MediaRecorder, HTMLMediaElement
// playback, or URL object-URL helpers. The stubs below give every test a
// working baseline; tests that need richer behavior override these per-test
// (see src/components/__tests__/VideoRecorder.test.tsx) and are responsible
// for restoring the original on teardown.

function createFakeStream() {
  const track = { stop: vi.fn() };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    getAudioTracks: () => [track],
  };
}

Object.defineProperty(globalThis.navigator, "mediaDevices", {
  configurable: true,
  writable: true,
  value: { getUserMedia: vi.fn(async () => createFakeStream()) },
});

// Models the real MediaRecorder state machine (inactive → recording →
// inactive) so callers that branch on `state` behave correctly under the
// default stub. Tests needing data emission swap in a custom subclass.
class MockMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(false);
  state: "inactive" | "recording" | "paused" = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn(() => {
    this.state = "recording";
  });
  stop = vi.fn(() => {
    this.state = "inactive";
    this.onstop?.();
  });
}
Object.defineProperty(globalThis, "MediaRecorder", {
  configurable: true,
  writable: true,
  value: MockMediaRecorder,
});

Object.defineProperty(window.HTMLMediaElement.prototype, "play", {
  configurable: true,
  writable: true,
  value: vi.fn().mockResolvedValue(undefined),
});
Object.defineProperty(window.HTMLMediaElement.prototype, "pause", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});
Object.defineProperty(window.HTMLMediaElement.prototype, "load", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

// VideoRecorder, TurnHistoryViewer, AuthContext, and ClipShareButtons all
// hit createObjectURL during normal render paths; jsdom returns undefined
// for both helpers, which then breaks downstream src= assignments.
let blobCounter = 0;
Object.defineProperty(URL, "createObjectURL", {
  configurable: true,
  writable: true,
  value: vi.fn(() => `blob:mock-${++blobCounter}`),
});
Object.defineProperty(URL, "revokeObjectURL", {
  configurable: true,
  writable: true,
  value: vi.fn(),
});

// Clear mock call history between tests so per-test assertions like
// `toHaveBeenCalledTimes(1)` don't observe leakage from earlier tests in
// the same file. Implementations are preserved (clear, not reset); tests
// that swap globals (e.g. globalThis.MediaRecorder) still own restoration.
afterEach(() => {
  vi.clearAllMocks();
});
