/**
 * Bridge to the native iOS clip renderer (`ClipEditor` Capacitor plugin in
 * ios/App/SkatehubbaClipEditor). It renders the same EditProject the web
 * preview shows, but with AVFoundation + Core Image on the GPU/media engine:
 * true 4K/60 HEVC export, sample-accurate speed ramps with pitch-corrected
 * audio, Vision-based stabilization, and no real-time limit.
 *
 * On the web — or on an iOS build that predates the plugin — every call
 * reports "unavailable" and the editor falls back to the canvas exporter.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { EditProject } from "../lib/clipEditor/types";
import type { ExportPlan } from "../lib/clipEditor/exportPlan";

export interface NativeRenderRequest {
  /** Native file URLs per angle id (from the camera / picker). */
  sources: Record<string, string>;
  project: EditProject;
  plan: Pick<ExportPlan, "width" | "height" | "fps" | "bitrate">;
  /** Absolute URLs for the music track and each SFX used. */
  audio: Record<string, string>;
  /** 4x5 color matrix for the chosen preset (looks.ts COLOR_PRESETS), so native and web grade identically. */
  colorMatrix: readonly number[];
  /** Also save the result to the Photos library. */
  saveToPhotos: boolean;
}

export interface NativeRenderResult {
  /** file:// URL of the rendered .mp4/.mov in the app's tmp directory. */
  fileUrl: string;
  /** Web-view URL for the same file (Capacitor.convertFileSrc). */
  webUrl: string;
  bytes: number;
  savedToPhotos: boolean;
}

interface ClipEditorPlugin {
  isAvailable(): Promise<{ available: boolean; maxWidth: number; maxFps: number; hevc: boolean }>;
  render(req: NativeRenderRequest): Promise<{ fileUrl: string; bytes: number; savedToPhotos: boolean }>;
  cancel(): Promise<void>;
  writeSourceChunk(opts: { id: string; data: string; append: boolean }): Promise<{ fileUrl: string }>;
  addListener(event: "progress", cb: (e: { progress: number }) => void): Promise<{ remove: () => Promise<void> }>;
}

const ClipEditor = registerPlugin<ClipEditorPlugin>("ClipEditor");

export interface NativeEditorSupport {
  available: boolean;
  supports4k: boolean;
  supports60: boolean;
}

const UNAVAILABLE: NativeEditorSupport = { available: false, supports4k: false, supports60: false };

/** Is the native renderer present on this device/build? Never throws. */
export async function getNativeEditorSupport(): Promise<NativeEditorSupport> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("ClipEditor")) return UNAVAILABLE;
  try {
    const r = await ClipEditor.isAvailable();
    if (!r.available) return UNAVAILABLE;
    return { available: true, supports4k: r.maxWidth >= 3840, supports60: r.maxFps >= 60 };
  } catch {
    return UNAVAILABLE;
  }
}

/** Render on device. Rejects with the plugin's error message on failure. */
export async function renderNative(
  req: NativeRenderRequest,
  onProgress?: (progress: number) => void,
): Promise<NativeRenderResult> {
  const sub = onProgress ? await ClipEditor.addListener("progress", (e) => onProgress(e.progress)) : null;
  try {
    const r = await ClipEditor.render(req);
    return { ...r, webUrl: Capacitor.convertFileSrc(r.fileUrl) };
  } finally {
    await sub?.remove();
  }
}

export async function cancelNativeRender(): Promise<void> {
  await ClipEditor.cancel();
}

/** Chunk size for staging a Blob into the native tmp dir (raw bytes per call). */
export const STAGE_CHUNK_BYTES = 1024 * 1024;

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Copy a picked/recorded clip into the app's tmp directory so AVFoundation can
 * open it. Streams in 1 MB slices so a 50 MB clip never sits in the bridge as
 * one giant string. Returns the native file:// URL.
 */
export async function stageSource(id: string, blob: Blob): Promise<string> {
  let fileUrl = "";
  for (let off = 0; off === 0 || off < blob.size; off += STAGE_CHUNK_BYTES) {
    const bytes = new Uint8Array(await blob.slice(off, off + STAGE_CHUNK_BYTES).arrayBuffer());
    ({ fileUrl } = await ClipEditor.writeSourceChunk({ id, data: toBase64(bytes), append: off > 0 }));
  }
  return fileUrl;
}
