interface BlockedStatusRowProps {
  username: string;
  busy: boolean;
  onUnblock: () => void;
}

/**
 * Inline "Blocked · Unblock" row under the profile header (SF-C2). The
 * blocked state stays visible on the page, not only in the ••• menu label.
 * Report this player stays in the ••• menu either way (App Review 1.2).
 */
export function BlockedStatusRow({ username, busy, onUnblock }: BlockedStatusRowProps) {
  return (
    <div role="status" className="-mt-4 mb-4 flex items-center gap-2 font-body text-sm text-dim">
      <span>Blocked</span>
      <span aria-hidden="true">·</span>
      <button
        type="button"
        onClick={onUnblock}
        disabled={busy}
        aria-busy={busy || undefined}
        aria-label={`Unblock @${username}`}
        className="min-h-11 rounded px-1 font-semibold text-white underline-offset-4 hover:underline disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-orange"
      >
        Unblock
      </button>
    </div>
  );
}
