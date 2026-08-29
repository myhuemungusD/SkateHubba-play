/**
 * Browser init-script that replaces the real camera / MediaRecorder APIs with
 * lightweight fakes.  Injected via `page.addInitScript(MEDIA_MOCK_SCRIPT)` before
 * each test that exercises the VideoRecorder component.
 *
 * Fake behaviour:
 *  - getUserMedia resolves immediately with a minimal fake MediaStream.
 *  - MediaRecorder produces a fake video Blob when stopped that is large
 *    enough (> 1024 bytes) to clear the minimum-size gate in
 *    `uploadVideo` (src/services/storage.ts) AND `storage.rules`, so the
 *    real resumable upload against the Storage emulator actually succeeds.
 *    A smaller blob would be rejected client-side as "too small" and the
 *    upload-then-persist path would never run. onRecorded() still receives
 *    a real Blob (not null), satisfying VideoRecorder.tsx's `size > 0` check.
 *  - MediaRecorder.isTypeSupported('video/webm') returns true so the component
 *    doesn't fall back to an unspecified mimeType.
 */

export const MEDIA_MOCK_SCRIPT = `
(function () {
  'use strict';

  // ── Fake MediaStream ──────────────────────────────────────────────────────
  // A REAL MediaStream, produced by capturing a blank canvas. It used to be a
  // plain object duck-typing the MediaStream surface, which Chromium now
  // rejects outright:
  //   "Failed to set the 'srcObject' property on 'HTMLMediaElement': The
  //    provided value is not of type '(MediaSourceHandle or MediaStream)'"
  // The recorder caught that as camera_access_failed and never left the
  // "Open Camera" state, so every recording spec timed out waiting for
  // controls that could not appear. captureStream() gives a genuine
  // MediaStream whose tracks carry the real EventTarget and getSettings()
  // surface the app reads (it listens for 'ended' to detect a revoked camera,
  // and reads frameRate for the fisheye canvas capture).
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width = 320;
  captureCanvas.height = 240;
  const captureCtx = captureCanvas.getContext('2d');
  if (captureCtx) {
    captureCtx.fillStyle = '#111';
    captureCtx.fillRect(0, 0, captureCanvas.width, captureCanvas.height);
  }
  // Held on the window so the canvas backing the stream is not garbage
  // collected mid-test, which would end the track and look like a revoked
  // camera.
  window.__e2eCaptureCanvas = captureCanvas;
  const fakeStream = captureCanvas.captureStream(30);

  // Override getUserMedia regardless of whether mediaDevices already exists.
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      writable: true,
      configurable: true,
    });
  }
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: () => Promise.resolve(fakeStream),
    writable: true,
    configurable: true,
  });

  // Fake clip payload, padded past the 1024-byte minimum enforced by
  // uploadVideo() and storage.rules so the resumable upload to the Storage
  // emulator is accepted instead of short-circuiting as "too small".
  const FAKE_VIDEO_BYTES = 'fake-video-data'.repeat(200); // ~3 KB

  // ── Fake MediaRecorder ────────────────────────────────────────────────────
  class FakeMediaRecorder {
    state = 'inactive';
    mimeType = 'video/webm';
    ondataavailable = null;
    onstop = null;
    _pendingTimer = null;

    constructor(_stream, options) {
      // Real MediaRecorder always reports the container/codec it settled on,
      // and the app derives the finished blob's type from it. Echoing the
      // requested type keeps the E2E path on the real blob-typing logic
      // instead of the "older browser" fallback.
      this.mimeType = (options && options.mimeType) || 'video/webm';
    }

    start() {
      this.state = 'recording';
      // Schedule a data chunk 50 ms after start so the component's ondataavailable
      // handler (set synchronously after construction) has been wired up.
      this._pendingTimer = setTimeout(() => {
        if (this.ondataavailable) {
          const chunk = new Blob([FAKE_VIDEO_BYTES], { type: 'video/webm' });
          this.ondataavailable({ data: chunk });
        }
      }, 50);
    }

    stop() {
      if (this._pendingTimer) clearTimeout(this._pendingTimer);
      this.state = 'inactive';

      // Deliver any final data before firing onstop, mirroring real MediaRecorder.
      if (this.ondataavailable) {
        const chunk = new Blob(['fake-video-data'], { type: 'video/webm' });
        this.ondataavailable({ data: chunk });
      }
      if (this.onstop) this.onstop();
    }

    static isTypeSupported(type) {
      return typeof type === 'string' && type.startsWith('video/webm');
    }
  }

  window.MediaRecorder = FakeMediaRecorder;
})();
`;
