import { useState } from "react";
import { Btn } from "./ui/Btn";
import { ErrorBanner } from "./ui/ErrorBanner";

export function DeleteAccountModal({
  onClose,
  onDeleteAccount,
}: {
  onClose: () => void;
  onDeleteAccount: () => Promise<void>;
}) {
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

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
      <div className="glass-card rounded-2xl p-6 max-w-sm w-full animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <h3 id="delete-modal-title" className="font-display text-xl text-white mb-2">
          Delete Account?
        </h3>
        <p className="font-body text-sm text-muted mb-4">
          This permanently deletes your profile and sign-in credentials. Your game history is retained for your
          opponents.
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
                setDeleting(false);
              }
            }}
            variant="danger"
            disabled={deleting}
          >
            {deleting ? "Deleting..." : "Delete Forever"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
