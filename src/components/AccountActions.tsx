import { useCallback, useState } from "react";
import { DeleteAccountModal } from "./DeleteAccountModal";
import { ConfirmSheet } from "./ui/ConfirmSheet";

interface Props {
  /** Export-my-data handler. Row is hidden when omitted. */
  onDownloadData?: () => Promise<void>;
  /** Account deletion handler. Row (and its modal) is hidden when omitted. */
  onDeleteAccount?: () => Promise<void>;
  /** Sign-out handler. Row is hidden when omitted; asks before signing out. */
  onSignOut?: () => void | Promise<void>;
}

/**
 * Account controls for the Settings screen: data export, sign out and account
 * deletion. Both rows are opt-in via props so a caller that can't service one
 * of them simply doesn't render it.
 *
 * The download state machine is local — it's a single caller's ~12 lines and
 * doesn't earn a shared hook. Deletion delegates its own in-flight/error state
 * to {@link DeleteAccountModal}.
 */
export function AccountActions({ onDownloadData, onDeleteAccount, onSignOut }: Props): React.ReactElement {
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const handleDownload = useCallback(async () => {
    if (!onDownloadData || downloading) return;
    setDownloadError("");
    setDownloading(true);
    try {
      await onDownloadData();
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : "Export failed — try again");
    } finally {
      setDownloading(false);
    }
  }, [onDownloadData, downloading]);

  return (
    <div className="space-y-2">
      {onDownloadData && (
        <button
          type="button"
          onClick={handleDownload}
          disabled={downloading}
          className="block w-full text-left p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange disabled:opacity-60 disabled:cursor-wait"
        >
          <p className="font-display text-sm text-white tracking-wide">Download my data</p>
          <p className="font-body text-xs text-faint mt-1">
            {downloading ? "Preparing your data…" : "Exports your profile and game history as a file you can keep."}
          </p>
          {downloadError && (
            <p role="alert" className="font-body text-xs text-brand-red mt-2">
              {downloadError}
            </p>
          )}
        </button>
      )}

      {onSignOut && (
        <button
          type="button"
          onClick={() => setConfirmSignOut(true)}
          className="block w-full text-left p-4 rounded-2xl glass-card hover:border-white/[0.1] transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
        >
          <p className="font-display text-sm text-white tracking-wide">Sign out</p>
          <p className="font-body text-xs text-faint mt-1">Signs you out on this device.</p>
        </button>
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

      {confirmSignOut && onSignOut && (
        <ConfirmSheet
          title="Sign out?"
          body="You'll need to sign in again to play."
          confirmLabel="Sign out"
          cancelLabel="Cancel"
          onCancel={() => setConfirmSignOut(false)}
          onConfirm={() => {
            setConfirmSignOut(false);
            void onSignOut();
          }}
        />
      )}

      {showDeleteModal && onDeleteAccount && (
        <DeleteAccountModal onClose={() => setShowDeleteModal(false)} onDeleteAccount={onDeleteAccount} />
      )}
    </div>
  );
}
