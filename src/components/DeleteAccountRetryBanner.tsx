import { useState } from "react";
import { useAuthContext } from "../context/AuthContext";

/**
 * One-shot recovery affordance for the GDPR account-deletion flow.
 *
 * Appears when the first delete attempt wiped Firestore but bounced on
 * auth/requires-recent-login and the user has since signed back in. At that
 * point useAuth reports profile: null (their users/{uid} doc is gone) so the
 * normal Lobby "Delete Account" button is hidden — this banner surfaces a
 * dedicated Finish deletion trigger that calls handleDeleteAccount and lets
 * AuthContext take the auth-delete-only retry branch.
 *
 * Mounted globally in AppScreens so it renders regardless of whether the
 * user lands on ProfileSetup or anywhere else post-sign-in.
 */
export function DeleteAccountRetryBanner() {
  const { user, pendingDeleteUid, handleDeleteAccount } = useAuthContext();
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
        <span className="font-display text-xs tracking-wider text-brand-red block">FINISH ACCOUNT DELETION</span>
        <span className="font-body text-xs text-muted">
          {error ?? "Your data is deleted. One tap removes your sign-in credentials."}
        </span>
      </div>
      <button
        type="button"
        onClick={onFinish}
        disabled={submitting}
        aria-label="Finish deleting your account"
        className="touch-target inline-flex items-center justify-center font-display text-[11px] tracking-wider text-brand-red border border-brand-red/50 rounded-xl px-3.5 py-1.5 whitespace-nowrap disabled:opacity-40 hover:bg-brand-red/[0.08] hover:border-brand-red/70 active:scale-[0.97] transition-all duration-300"
      >
        {submitting ? "..." : "Finish"}
      </button>
    </div>
  );
}
