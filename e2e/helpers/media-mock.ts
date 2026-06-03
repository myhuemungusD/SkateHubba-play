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
  const fakeTrack = { stop: () => {}, kind: 'video', enabled: true };
  const fakeStream = {
    getTracks: () => [fakeTrack],
    getVideoTracks: () => [fakeTrack],
    getAudioTracks: () => [],
    active: true,
  };

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
    ondataavailable = null;
    onstop = null;
    _pendingTimer = null;

    constructor(_stream, _options) {
      // no-op: we ignore the stream and options
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
