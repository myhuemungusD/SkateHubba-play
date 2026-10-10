import "@testing-library/jest-dom/vitest";
import { Blob as NodeBlob } from "node:buffer";
import { createRequire } from "node:module";

// jsdom 30.1 moved a wrapper's impl object from an own `Symbol(impl)`
// property to a private field (and renamed its byte store `_buffer` →
// `_bytes`). Vitest 4's jsdom compat `URL.createObjectURL` still reads
// `blob[Symbol(impl)]._buffer`, so every createObjectURL on a jsdom Blob threw
// "Cannot read properties of undefined (reading '_buffer')" — which is what
// broke the recorder, avatar, clip-upload and gameplay suites on jsdom 30.
// Route jsdom Blobs through jsdom's own `implForWrapper` instead, which is the
// same fix Vitest 5 ships. Self-disabling: it only installs when the stock
// shim actually fails, so it is inert on older jsdom and can be deleted once
// the repo is on Vitest 5.
{
  const probeUrl = (() => {
    try {
      return URL.createObjectURL(new Blob([]));
    } catch {
      return null;
    }
  })();
  if (probeUrl !== null) {
    URL.revokeObjectURL(probeUrl);
  } else {
    const requireFromHere = createRequire(import.meta.url);
    const { implForWrapper } = requireFromHere("jsdom/lib/generated/idl/utils.js") as {
      implForWrapper: (wrapper: unknown) => { _bytes?: Uint8Array } | null;
    };
    // Vitest's compat class extends Node's URL; its parent holds the native
    // createObjectURL that accepts a Node Blob.
    const NodeURL = Object.getPrototypeOf(URL) as typeof URL;
    const compatCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (obj: Blob | MediaSource): string => {
      if (obj instanceof Blob) {
        const bytes = implForWrapper(obj)?._bytes;
        if (bytes) {
          const nodeBlob = new NodeBlob([new Uint8Array(bytes)], { type: obj.type });
          return NodeURL.createObjectURL(nodeBlob as unknown as Blob);
        }
      }
      return compatCreateObjectURL(obj);
    };
  }
}

// Mock Firebase Messaging — jsdom lacks Service Worker and Push APIs required
// by the Firebase Messaging SDK, which throws "unsupported-browser" on init.
vi.mock("firebase/messaging", () => ({
  getMessaging: vi.fn(() => ({})),
  getToken: vi.fn(() => Promise.resolve(null)),
  onMessage: vi.fn(() => vi.fn()),
  isSupported: vi.fn(() => Promise.resolve(true)),
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
