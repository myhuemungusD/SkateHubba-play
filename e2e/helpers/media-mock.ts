/**
 * Browser init-script that replaces the real camera / MediaRecorder APIs with
 * lightweight fakes.  Injected via `page.addInitScript(MEDIA_MOCK_SCRIPT)` before
 * each test that exercises the VideoRecorder component.
 *
 * Fake behaviour:
 *  - getUserMedia resolves immediately with a REAL MediaStream captured from
 *    an off-screen canvas. A plain object with getTracks() is not enough:
 *    useMediaRecorder assigns the stream to `video.srcObject`, and the DOM
 *    rejects anything that isn't a MediaStream — the component then renders
 *    "Camera unavailable: Failed to set the 'srcObject' property...". The
 *    canvas keeps painting so the track actually produces frames.
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

  // ── Fake camera stream ────────────────────────────────────────────────────
  // canvas.captureStream() yields a genuine MediaStream (real
  // MediaStreamTrack, real event-target surface, real getSettings()), which is
  // what the app needs: it assigns the stream to video.srcObject and calls
  // play(). The canvas is repainted on a timer so the track keeps emitting
  // frames instead of going idle after the first one.
  let fakeStream = null;
  function getFakeStream() {
    if (fakeStream) return fakeStream;
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const ctx = canvas.getContext('2d');
    let tick = 0;
    const paint = () => {
      tick += 1;
      ctx.fillStyle = tick % 2 === 0 ? '#FF6B00' : '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    };
    paint();
    setInterval(paint, 100);
    fakeStream = canvas.captureStream(30);
    return fakeStream;
  }

  // Override getUserMedia regardless of whether mediaDevices already exists.
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {},
      writable: true,
      configurable: true,
    });
  }
  Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
    value: () => Promise.resolve(getFakeStream()),
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
