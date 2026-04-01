import "@testing-library/jest-dom/vitest";
import React from "react";

// Override React.lazy so lazy-loaded screens resolve synchronously in tests.
// Without this, every screen transition through React.lazy + Suspense requires
// async waitFor() calls, breaking 100+ existing synchronous assertions.
const origLazy = React.lazy;

(React as any).lazy = function eagerLazy(factory: () => Promise<{ default: React.ComponentType<any> }>) {
  const lazyComponent = origLazy(factory);
  // Eagerly kick off the factory so the module loads immediately.
  // Then poke React's internal lazy payload to mark it as resolved
  // before the component is first rendered, preventing Suspense.
  factory().then((mod) => {
    // React lazy internals: _payload._status 1 = resolved, _result = component

    const payload = (lazyComponent as any)._payload;
    if (payload && payload._status !== 1) {
      payload._status = 1;
      payload._result = mod.default;
    }
  });
  return lazyComponent;
};

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
