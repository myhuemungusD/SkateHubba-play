import { useState } from "react";
import { useAuthContext } from "../context/AuthContext";

/**
 * Recovery affordance for an account deletion that was started and did not
 * finish, shown to the signed-in user it belongs to.
 *
 * Two different states, and the copy must not blur them:
 *  - The server confirmed the erasure and only the sign-in record survived
 *    (`pendingDeleteErased`). The data really is gone, the profile doc with
 *    it, so the Lobby "Delete Account" button is hidden and this banner is the
 *    only way to finish.
 *  - Anything else: the request failed (a 500, the network, a stale sign-in)
 *    or the app was closed mid-way. Erasure did not complete, so the copy says
 *    so and offers a retry. Claiming the data was deleted here would be false.
 *
 * Mounted globally in AppScreens so it renders regardless of whether the
 * user lands on ProfileSetup or anywhere else post-sign-in.
 */
export function DeleteAccountRetryBanner() {
  const { user, pendingDeleteUid, pendingDeleteErased, handleDeleteAccount } = useAuthContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Banner is visible only when the signed-in user is the one mid-deletion.
  if (!user || !pendingDeleteUid || user.uid !== pendingDeleteUid) return null;

  const onFinish = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await handleDeleteAccount();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deletion failed — try again");
      setSubmitting(false);
    }
  };

  return (
    <div
      role="alert"
      aria-live="polite"
      className="mx-5 mt-4 p-3.5 rounded-2xl bg-[rgba(255,61,26,0.08)] border border-brand-red/50 flex items-center justify-between gap-3 shadow-[0_0_16px_rgba(255,61,26,0.08)] animate-fade-in"
    >
      <div>
        <span className="font-display text-xs tracking-wider text-brand-red block">
          {pendingDeleteErased ? "FINISH ACCOUNT DELETION" : "ACCOUNT NOT DELETED"}
        </span>
        <span className="font-body text-xs text-muted">
          {error ??
            (pendingDeleteErased
              ? "Your data is deleted. One tap removes your sign-in credentials."
              : "Your account deletion didn't finish. Tap Retry to try again.")}
        </span>
      </div>
      <button
        type="button"
        onClick={onFinish}
        disabled={submitting}
        aria-label={pendingDeleteErased ? "Finish deleting your account" : "Retry deleting your account"}
        className="touch-target inline-flex items-center justify-center font-display text-[11px] tracking-wider text-brand-red border border-brand-red/50 rounded-xl px-3.5 py-1.5 whitespace-nowrap disabled:opacity-40 hover:bg-brand-red/[0.08] hover:border-brand-red/70 active:scale-[0.97] transition-all duration-300"
      >
        {submitting ? "..." : pendingDeleteErased ? "Finish" : "Retry"}
      </button>
    </div>
  );
}
