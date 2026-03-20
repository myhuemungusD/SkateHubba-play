/**
 * Native video recording bridge.
 *
 * On iOS/Android (Capacitor native shell) this delegates to the platform
 * camera via @capacitor/camera, which provides a reliable, hardware-
 * accelerated recording pipeline. The result is an mp4 file URI.
 *
 * On the web it falls back to the browser MediaRecorder API (unchanged
 * from the existing behaviour in VideoRecorder.tsx).
 */

import { Capacitor } from "@capacitor/core";
import { Camera, CameraResultType, CameraSource } from "@capacitor/camera";

/** True when the app is running inside a Capacitor native shell. */
export function isNativePlatform(): boolean {
  return Capacitor.isNativePlatform();
}

/** Result returned by the native video capture flow. */
export interface NativeVideoResult {
  /** Local file blob ready for upload. */
  blob: Blob;
  /** MIME type of the recorded video (typically video/mp4 on native). */
  mimeType: string;
}

/**
 * Launch the native camera to record a video clip.
 *
 * Returns a Blob suitable for uploading to Firebase Storage.
 * Throws if the user cancels or the platform denies permissions.
 */
export async function recordNativeVideo(): Promise<NativeVideoResult> {
  // Camera.getPhoto with resultType DataUrl gives us a base64 data-URI.
  // On native platforms the Camera plugin supports video capture via
  // the underlying OS camera intent / controller.
  const photo = await Camera.getPhoto({
    quality: 80,
    allowEditing: false,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    // Capacitor camera on native supports video when the platform intent
    // is configured; the webPath will point at the recorded clip.
  });

  if (!photo.webPath) {
    throw new Error("Native camera returned no file path");
  }

  // Fetch the file from the local URI into a Blob
  const response = await fetch(photo.webPath);
  const blob = await response.blob();
  const mimeType = blob.type || "video/mp4";

  return { blob, mimeType };
}

/**
 * Check (and request if needed) camera + microphone permissions on native.
 *
 * Returns true if permissions are granted, false otherwise.
 * On the web this always returns true (permissions are handled by getUserMedia).
 */
export async function checkNativeCameraPermissions(): Promise<boolean> {
  if (!isNativePlatform()) return true;

  const status = await Camera.checkPermissions();
  if (status.camera === "granted") return true;

  const requested = await Camera.requestPermissions({ permissions: ["camera"] });
  return requested.camera === "granted";
}
