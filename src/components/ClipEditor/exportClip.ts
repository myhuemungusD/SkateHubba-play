import type { EditProject } from "../../lib/clipEditor/types";
import { planExport, NATIVE_CAPABILITIES, WEB_CAPABILITIES } from "../../lib/clipEditor/exportPlan";
import { getSound } from "../../lib/clipEditor/sfxLibrary";
import { getTrack } from "../../lib/clipEditor/musicLibrary";
import type { EditorEngine } from "../../lib/clipEditor/engine";
import { getNativeEditorSupport, renderNative, stageSource } from "../../services/clipEditorNative";

/** Absolute URLs for every audio asset the edit uses (music + each distinct SFX). */
export function audioUrls(p: EditProject, origin = window.location.origin): Record<string, string> {
  const out: Record<string, string> = {};
  const track = p.music && getTrack(p.music.trackId);
  if (track) out[track.id] = new URL(track.src, origin).href;
  for (const s of p.sfx) {
    const sound = getSound(s.soundId);
    if (sound) out[sound.id] = new URL(sound.src, origin).href;
  }
  return out;
}

export interface ExportResult {
  /** Feed-ready file (always under the upload cap). */
  blob: Blob;
  /** True when a full-quality copy also went to Photos. */
  savedFullQuality: boolean;
}

/**
 * Export the edit. Native (iOS plugin present): AVFoundation render at the
 * chosen quality; if that is too big to post, the full file goes to Photos and
 * a second, feed-sized render is returned. Web: real-time canvas export.
 */
export async function exportClip(
  project: EditProject,
  sources: Record<string, Blob>,
  engine: EditorEngine,
  onProgress: (p: number) => void,
): Promise<ExportResult> {
  const native = await getNativeEditorSupport();
  if (!native.available) {
    const plan = planExport(project, WEB_CAPABILITIES);
    const bitrate = plan.exceedsUploadCap ? plan.uploadBitrate : plan.bitrate;
    const blob = await engine.exportWeb({ ...plan, bitrate }, onProgress);
    return { blob, savedFullQuality: false };
  }
  const caps = {
    ...NATIVE_CAPABILITIES,
    maxResolution: native.supports4k ? ("4k" as const) : ("1080p" as const),
    max60fps: native.supports60,
  };
  const plan = planExport(project, caps);
  const staged: Record<string, string> = {};
  for (const [id, blob] of Object.entries(sources)) staged[id] = await stageSource(id, blob);
  const audio = audioUrls(project);
  const base = { sources: staged, project, audio };
  const full = await renderNative(
    {
      ...base,
      plan: { width: plan.width, height: plan.height, fps: plan.fps, bitrate: plan.bitrate },
      saveToPhotos: plan.exceedsUploadCap,
    },
    (p) => onProgress(plan.exceedsUploadCap ? p / 2 : p),
  );
  let result = full;
  if (plan.exceedsUploadCap) {
    result = await renderNative(
      {
        ...base,
        plan: { width: plan.width, height: plan.height, fps: plan.fps, bitrate: plan.uploadBitrate },
        saveToPhotos: false,
      },
      (p) => onProgress(0.5 + p / 2),
    );
  }
  const res = await fetch(result.webUrl);
  // The native renderer always writes MPEG-4; pin the type so storage.rules' .mp4/contentType pairing holds.
  return { blob: new Blob([await res.blob()], { type: "video/mp4" }), savedFullQuality: full.savedToPhotos };
}
