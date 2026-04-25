interface Props {
  username: string;
  isBlocked: boolean;
  blockLoading: boolean;
  showBlockConfirm: boolean;
  onOpenBlockConfirm: () => void;
  onCancelBlockConfirm: () => void;
  onConfirmBlock: () => void;
  onUnblock: () => void;
}

export function BlockControls({
  username,
  isBlocked,
  blockLoading,
  showBlockConfirm,
  onOpenBlockConfirm,
  onCancelBlockConfirm,
  onConfirmBlock,
  onUnblock,
}: Props) {
  if (isBlocked) {
    return (
      <div className="mb-8">
        <div className="flex items-center justify-between p-3 rounded-xl border border-brand-red/20 bg-brand-red/[0.06]">
          <span className="font-body text-xs text-brand-red">You have blocked this user</span>
          <button
            type="button"
            onClick={onUnblock}
            disabled={blockLoading}
            className="touch-target inline-flex items-center justify-center font-body text-xs text-muted hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-border hover:border-border-hover disabled:opacity-50"
          >
            {blockLoading ? "..." : "Unblock"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-8">
      {showBlockConfirm ? (
        <div className="flex items-center justify-between p-3 rounded-xl border border-brand-red/20 bg-brand-red/[0.06]">
          <span className="font-body text-xs text-subtle">
            Block @{username}? They won&apos;t be able to challenge you.
          </span>
          <div className="flex gap-2 shrink-0 ml-3">
            <button
              type="button"
              onClick={onCancelBlockConfirm}
              className="touch-target inline-flex items-center justify-center font-body text-xs text-muted hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-border"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmBlock}
              disabled={blockLoading}
              className="touch-target inline-flex items-center justify-center font-body text-xs text-brand-red hover:text-white transition-colors px-3 py-1.5 rounded-lg border border-brand-red/30 hover:bg-brand-red/20 disabled:opacity-50"
            >
              {blockLoading ? "..." : "Block"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenBlockConfirm}
          className="touch-target inline-flex items-center justify-center font-body text-xs text-subtle hover:text-brand-red transition-colors"
        >
          Block this player
        </button>
      )}
    </div>
  );
}
