import { useState, useRef } from "react";
import { Btn } from "./ui/Btn";
import { ErrorBanner } from "./ui/ErrorBanner";
import { useFocusTrap } from "../hooks/useFocusTrap";

export function DeleteAccountModal({
  onClose,
  onDeleteAccount,
}: {
  onClose: () => void;
  onDeleteAccount: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  // Set when the Apple sheet was closed: nothing was deleted, and the delete
  // button becomes "Try Again", which re-runs the flow and reopens the sheet.
  const [appleConfirmNeeded, setAppleConfirmNeeded] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-6 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-modal-title"
      onClick={() => {
        if (!deleting) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !deleting) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="glass-card rounded-2xl p-6 max-w-sm w-full animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="delete-modal-title" className="font-display text-xl text-white mb-2">
          Delete Account?
        </h3>
        <p className="font-body text-sm text-muted mb-4">
          This permanently deletes your profile, sign-in, clips, finished games and their videos. Games still in
          progress end as a forfeit to your opponent, with your name and videos removed. Moderation records (such as a
          ban) and verified-pro lineage are kept by account ID.
          <strong className="text-brand-red"> This cannot be undone.</strong>
        </p>
        {deleteError && <ErrorBanner message={deleteError} onDismiss={() => setDeleteError("")} />}
        <div className="flex gap-3">
          <Btn
            onClick={() => {
              setDeleteError("");
              onClose();
            }}
            variant="secondary"
            disabled={deleting}
            autoFocus
          >
            Cancel
          </Btn>
          <Btn
            onClick={async () => {
              setDeleting(true);
              setDeleteError("");
              try {
                await onDeleteAccount();
              } catch (err: unknown) {
                setDeleteError(err instanceof Error ? err.message : "Deletion failed — try again");
                setAppleConfirmNeeded((err as { code?: unknown } | null)?.code === "account-delete/cancelled");
                setDeleting(false);
              }
            }}
            variant="danger"
            disabled={deleting}
          >
            {deleting ? "Deleting..." : appleConfirmNeeded ? "Try Again" : "Delete Forever"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
