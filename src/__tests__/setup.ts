import "@testing-library/jest-dom/vitest";

// Mock Firebase Messaging — jsdom lacks Service Worker and Push APIs required
// by the Firebase Messaging SDK, which throws "unsupported-browser" on init.
vi.mock("firebase/messaging", () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve(null)),
  onMessage: vi.fn(() => vi.fn()),
}));

// Mock navigator.mediaDevices with a fake stream so VideoRecorder enters
// preview state normally. The stream has no real tracks but satisfies the API.
const mockStop = vi.fn();
const mockStream = {
  getTracks: () => [{ stop: mockStop }],
  getVideoTracks: () => [{ stop: mockStop }],
  getAudioTracks: () => [{ stop: mockStop }],
};
Object.defineProperty(globalThis.navigator, "mediaDevices", {
  writable: true,
  configurable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue(mockStream),
  },
});

// Stub MediaRecorder (not needed in demo mode, but prevents ReferenceError if accessed).
class MockMediaRecorder {
  static isTypeSupported = vi.fn().mockReturnValue(false);
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
