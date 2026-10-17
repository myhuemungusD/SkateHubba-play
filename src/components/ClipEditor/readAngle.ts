import type { EditorAngle } from "../../lib/clipEditor/types";

/** Probe a clip's duration and size via a detached <video>. Resolves with an object URL the engine can reuse. */
export function readAngle(blob: Blob, id: string, label: string): Promise<{ angle: EditorAngle; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    v.onloadedmetadata = () => {
      const durationSec = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
      if (durationSec === 0) return reject(new Error("no duration"));
      resolve({
        url,
        // Capture fps isn't exposed by HTMLVideoElement; assume 60 when the
        // camera (PR #673) records high-frame-rate, the native plugin reads the real value.
        angle: {
          id,
          label,
          durationSec,
          offsetSec: 0,
          width: v.videoWidth || 1920,
          height: v.videoHeight || 1080,
          fps: 60,
        },
      });
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("unreadable"));
    };
    v.src = url;
  });
}
