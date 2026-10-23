import { useEffect, useRef } from "react";
import type { CaptureState } from "./useMediaRecorder";
import { hasGrantedCameraAndMic } from "../components/mediaPermissions";

/**
 * Release the camera while the app is in the background and bring the live
 * preview back when it returns — battery and privacy (the green dot goes off
 * as soon as the skater leaves the app). A take in progress is stopped and
 * kept, not thrown away. Leaving the screen is covered by the recorder's own
 * unmount cleanup.
 */
export function useCameraRelease({
  state,
  isNative,
  releaseCamera,
  openNativeCamera,
  openCamera,
  cancelTimer,
}: {
  state: CaptureState;
  isNative: boolean;
  releaseCamera: () => void;
  openNativeCamera: () => Promise<void>;
  openCamera: () => Promise<void>;
  cancelTimer: () => void;
}): void {
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    // A preview we let go of (or one still coming up) returns; a take that
    // was stopped and kept stays finished.
    let releasedPreview = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        cancelTimer();
        releasedPreview = stateRef.current === "preview" || stateRef.current === "idle";
        releaseCamera();
        return;
      }
      if (!releasedPreview) return;
      releasedPreview = false;
      if (isNative) {
        void openNativeCamera();
        return;
      }
      // Same rule as screen entry: never prompt outside a user gesture.
      void hasGrantedCameraAndMic().then((granted) => {
        if (granted) void openCamera();
      });
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isNative, releaseCamera, openNativeCamera, openCamera, cancelTimer]);
}
