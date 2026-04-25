interface Props {
  onDownloadData?: () => Promise<void>;
  downloadingData: boolean;
  downloadError: string;
  handleDownload: () => Promise<void>;
  openDeleteModal: () => void;
}

export function AccountActionsFooter({
  onDownloadData,
  downloadingData,
  downloadError,
  handleDownload,
  openDeleteModal,
}: Props) {
  return (
    <>
      <div className="mt-8 flex flex-col items-center gap-1">
        {onDownloadData && (
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloadingData}
            aria-label="Download a copy of my data"
            className="touch-target inline-flex items-center justify-center font-body text-xs text-dim underline underline-offset-2 hover:text-brand-orange transition-colors disabled:opacity-60 disabled:cursor-wait rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
          >
            {downloadingData ? "Preparing your data…" : "Download My Data"}
          </button>
        )}
        {downloadError && (
          <p role="alert" className="font-body text-xs text-brand-red max-w-xs text-center">
            {downloadError}
          </p>
        )}
        <button
          type="button"
          onClick={openDeleteModal}
          className="touch-target inline-flex items-center justify-center font-body text-xs text-dim underline underline-offset-2 hover:text-brand-red transition-colors rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
        >
          Delete Account
        </button>
      </div>

      <div className="brand-watermark mt-6">
        <div className="brand-divider flex-1 max-w-16" />
        <img src="/logonew.webp" alt="" draggable={false} className="h-4 w-auto select-none" aria-hidden="true" />
        <div className="brand-divider flex-1 max-w-16" />
      </div>
    </>
  );
}
