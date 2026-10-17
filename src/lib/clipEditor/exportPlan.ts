import type { EditProject, ExportFps, ExportResolution } from "./types";
import { MAX_UPLOAD_BYTES } from "../../constants/video";
import { outputDuration } from "./speed";

export const RESOLUTIONS: Record<ExportResolution, { width: number; height: number; label: string }> = {
  "720p": { width: 1280, height: 720, label: "720p" },
  "1080p": { width: 1920, height: 1080, label: "1080p HD" },
  "4k": { width: 3840, height: 2160, label: "4K" },
};

/** Target bitrates (bps) at 30fps — Apple's HEVC guidance; 60fps gets 1.5x. */
const BASE_BITRATE: Record<ExportResolution, number> = {
  "720p": 6_000_000,
  "1080p": 12_000_000,
  "4k": 40_000_000,
};

export interface ExportCapabilities {
  native: boolean;
  maxResolution: ExportResolution;
  max60fps: boolean;
  stabilization: boolean;
}

/** Web exports in real time through canvas + MediaRecorder; cap it at 1080p. */
export const WEB_CAPABILITIES: ExportCapabilities = {
  native: false,
  maxResolution: "1080p",
  max60fps: true,
  stabilization: false,
};

export const NATIVE_CAPABILITIES: ExportCapabilities = {
  native: true,
  maxResolution: "4k",
  max60fps: true,
  stabilization: true,
};

const ORDER: ExportResolution[] = ["720p", "1080p", "4k"];

export function allowedResolutions(caps: ExportCapabilities): ExportResolution[] {
  return ORDER.slice(0, ORDER.indexOf(caps.maxResolution) + 1);
}

export function bitrateFor(res: ExportResolution, fps: ExportFps): number {
  return fps === 60 ? BASE_BITRATE[res] * 1.5 : BASE_BITRATE[res];
}

export interface ExportPlan {
  width: number;
  height: number;
  fps: ExportFps;
  bitrate: number;
  durationSec: number;
  estimatedBytes: number;
  /** True when the file is too big to post to the feed (still saves to Photos). */
  exceedsUploadCap: boolean;
  /** Bitrate that would fit the upload cap, for the "post" version. */
  uploadBitrate: number;
}

/** Resolve the project's export choice against what this device can do. */
export function planExport(p: EditProject, caps: ExportCapabilities): ExportPlan {
  const allowed = allowedResolutions(caps);
  const res = allowed.includes(p.export.resolution) ? p.export.resolution : caps.maxResolution;
  const fps: ExportFps = p.export.fps === 60 && caps.max60fps ? 60 : 30;
  const { width, height } = RESOLUTIONS[res];
  const bitrate = bitrateFor(res, fps);
  const durationSec = outputDuration(p);
  const estimatedBytes = Math.round((bitrate * durationSec) / 8 + (192_000 * durationSec) / 8);
  const budget = MAX_UPLOAD_BYTES * 0.85;
  const uploadBitrate = durationSec > 0 ? Math.min(bitrate, Math.floor((budget * 8) / durationSec) - 192_000) : bitrate;
  return {
    width,
    height,
    fps,
    bitrate,
    durationSec,
    estimatedBytes,
    exceedsUploadCap: estimatedBytes >= budget,
    uploadBitrate,
  };
}
