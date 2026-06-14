import { useLayoutEffect, useRef } from "react";
import type { UploadProgress as UploadProgressData } from "../services/storage";

/**
 * Visual progress bar for video uploads.
 * Shows percentage and bytes transferred.
 */
export function UploadProgress({ progress }: { progress: UploadProgressData | null }) {
  // The fill width is a runtime percentage, so it can't be a build-time
  // Tailwind class. Apply it through the CSSOM via a ref rather than an inline
  // `style=` attribute so the CSP `style-src` can drop `'unsafe-inline'`.
  const barRef = useRef<HTMLDivElement | null>(null);
  const percent = progress?.percent ?? 0;
  useLayoutEffect(() => {
    if (barRef.current) barRef.current.style.width = `${percent}%`;
  }, [percent]);

  if (!progress) return null;

  const sizeMB = (progress.totalBytes / (1024 * 1024)).toFixed(1);
  const transferredMB = (progress.bytesTransferred / (1024 * 1024)).toFixed(1);

  return (
    <div
      className="w-full max-w-md mx-auto mt-4 animate-fade-in"
      role="progressbar"
      aria-valuenow={progress.percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Video upload progress"
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-display text-sm tracking-wider text-brand-orange">Uploading video...</span>
        <span className="font-display text-sm tracking-wider text-white tabular-nums">{progress.percent}%</span>
      </div>
      <div className="w-full h-2.5 bg-surface-alt border border-border rounded-full overflow-hidden">
        <div
          ref={barRef}
          className="h-full bg-gradient-to-r from-brand-orange to-[#FF8533] rounded-full transition-all duration-300 ease-out shadow-[0_0_8px_rgba(255,107,0,0.3)]"
        />
      </div>
      <p className="font-body text-[11px] text-subtle mt-1.5 text-center tabular-nums">
        {transferredMB} / {sizeMB} MB
      </p>
    </div>
  );
}
