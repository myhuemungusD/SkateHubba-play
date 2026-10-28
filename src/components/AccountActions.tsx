import { useCallback, useId, useState } from "react";
import { DeleteAccountModal } from "./DeleteAccountModal";
import { describeIncompleteExport, type DataDownloadOutcome } from "../services/userData";

/**
 * Confirmation for a finished native share sheet. Web downloads get none (the
 * browser shows its own download UI, as before) and a closed sheet saved
 * nothing, so neither is confirmed.
 */
const SHARED_MESSAGE = "Your data file is ready. Find it where you saved or sent it.";

/**
 * Shown whenever the file is missing data, on every platform: the file itself
 * carries the same warning, but nobody should have to open the JSON to learn
 * it's incomplete. Worded so it's true whether the file was downloaded,
 * saved or sent from the share sheet.
 */
function incompleteMessage(outcome: DataDownloadOutcome): string {
  return `Your data file is ready, but some of it is missing. ${describeIncompleteExport(
    outcome.missingSections,
    outcome.truncatedSections,
  )}`;
}

interface Props {
  /** Export-my-data handler. Row is hidden when omitted. */
  onDownloadData?: () => Promise<DataDownloadOutcome | void>;
  /** Account deletion handler. Row (and its modal) is hidden when omitted. */
  onDeleteAccount?: () => Promise<void>;
}

/**
 * GDPR/CCPA account controls for the Settings screen: data export and account
 * deletion. Both rows are opt-in via props so a caller that can't service one
 * of them simply doesn't render it.
 *
 * The download state machine is local — it's a single caller's ~12 lines and
 * doesn't earn a shared hook. Deletion delegates its own in-flight/error state
 * to {@link DeleteAccountModal}.
 */
export function AccountActions({ onDownloadData, onDeleteAccount }: Props): React.ReactElement {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [downloadDone, setDownloadDone] = useState("");
  const [downloadWarning, setDownloadWarning] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const feedbackId = useId();

  const handleDownload = useCallback(async () => {
    if (!onDownloadData || downloading) return;
    setDownloadError("");
    setDownloadDone("");
    setDownloadWarning("");
    setDownloading(true);
    try {
      const outcome = await onDownloadData();
      // A closed share sheet saved nothing, so there is nothing to report.
      if (!outcome || outcome.saved === "cancelled") return;
      if (outcome.missingSections.length > 0 || outcome.truncatedSections.length > 0) {
        setDownloadWarning(incompleteMessage(outcome));
      } else if (outcome.saved === "shared") setDownloadDone(SHARED_MESSAGE);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Export failed — try again");
    } finally {
      setDownloading(false);
    }
  }, [onDownloadData, downloading]);

  return (
    <div className="space-y-2">
      {onDownloadData && (
        <div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading}
            aria-describedby={feedbackId}
            className="block w-full text-left p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-60 disabled:cursor-wait"
          >
            <span className="block font-display text-sm text-white tracking-wide">Download my data</span>
            <span className="block font-body text-xs text-faint mt-1">
              {downloading
                ? "Preparing your data…"
                : "Exports your profile, games, clips and more as a file you can keep."}
            </span>
          </button>
          {/* Outside the button: a button's children are presentational, so
              screen readers (VoiceOver in WKWebView) may not announce a live
              region inside it, and it would join the button's name. */}
          <div id={feedbackId} className="px-4">
            {downloadDone && (
              <p role="status" className="font-body text-xs text-brand-green mt-2">
                {downloadDone}
              </p>
            )}
            {downloadWarning && (
              <p role="alert" className="font-body text-xs text-brand-orange mt-2">
                {downloadWarning}
              </p>
            )}
            {downloadError && (
              <p role="alert" className="font-body text-xs text-brand-red mt-2">
                {downloadError}
              </p>
            )}
          </div>
        </div>
      )}

      {onDeleteAccount && (
        <button
          type="button"
          onClick={() => setShowDeleteModal(true)}
          className="block w-full text-left p-4 rounded-2xl glass-card hover:border-brand-red/30 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-red"
        >
          <p className="font-display text-sm text-brand-red tracking-wide">Delete account</p>
          <p className="font-body text-xs text-faint mt-1">
            Permanently removes your profile and sign-in. This cannot be undone.
          </p>
        </button>
      )}

      {showDeleteModal && onDeleteAccount && (
        <DeleteAccountModal onClose={() => setShowDeleteModal(false)} onDeleteAccount={onDeleteAccount} />
      )}
    </div>
  );
}
