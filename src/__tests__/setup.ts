import "@testing-library/jest-dom/vitest";

// Mock navigator.mediaDevices with a fake stream so VideoRecorder enters
// preview state normally. The stream has no real tracks but satisfies the API.
const mockStream = {
  getTracks: () => [{ stop: vi.fn() }],
  getVideoTracks: () => [{ stop: vi.fn() }],
  getAudioTracks: () => [{ stop: vi.fn() }],
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
(globalThis as any).MediaRecorder = MockMediaRecorder;
