import "@testing-library/jest-dom/vitest";

// Mock navigator.mediaDevices to simulate unavailable camera in jsdom.
// VideoRecorder will fall back to demo mode (no actual stream) which is simpler to test.
Object.defineProperty(globalThis.navigator, "mediaDevices", {
  writable: true,
  configurable: true,
  value: {
    getUserMedia: vi.fn().mockRejectedValue(new Error("Camera unavailable in jsdom")),
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
(globalThis as any).MediaRecorder = MockMediaRecorder;
