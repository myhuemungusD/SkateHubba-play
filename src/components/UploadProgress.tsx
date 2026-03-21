import type { UploadProgress as UploadProgressData } from "../services/storage";

/**
 * Visual progress bar for video uploads.
 * Shows percentage and bytes transferred.
 */
export function UploadProgress({ progress }: { progress: UploadProgressData | null }) {
  if (!progress) return null;

  const sizeMB = (progress.totalBytes / (1024 * 1024)).toFixed(1);
  const transferredMB = (progress.bytesTransferred / (1024 * 1024)).toFixed(1);

  return (
    <div
      className="w-full max-w-md mx-auto mt-4"
      role="progressbar"
      aria-valuenow={progress.percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Video upload progress"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-display text-sm tracking-wider text-brand-orange">Uploading video...</span>
        <span className="font-display text-sm tracking-wider text-white">{progress.percent}%</span>
      </div>
      <div className="w-full h-2 bg-surface-alt border border-border rounded-full overflow-hidden">
        <div
          className="h-full bg-brand-orange rounded-full transition-all duration-300 ease-out"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <p className="font-body text-[11px] text-faint mt-1 text-center">
        {transferredMB} / {sizeMB} MB
      </p>
    </div>
  );
}
