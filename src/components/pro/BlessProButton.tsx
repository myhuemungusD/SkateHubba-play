import { useCallback, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useSwipeDownToClose } from "../useSwipeDownToClose";
import { Sparkles, X } from "lucide-react";
import {
  BLESSING_REASON_MAX,
  BLESSING_REASON_MIN,
  blessSkater,
  blessingErrorMessage,
} from "../../services/proBlessing";

interface Props {
  targetUid: string;
  username: string;
}

/**
 * "Put on" (the blessing action) on another skater's profile. The parent mounts it only for a
 * verified-pro viewer looking at a non-pro, with the blessing flag on. The
 * server re-checks everything; this is just the ask.
 */
export function BlessProButton({ targetUid, username }: Props) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useFocusTrap(dialogRef, open, close);
  useSwipeDownToClose(dialogRef, close, open);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const len = reason.trim().length;
  const valid = len >= BLESSING_REASON_MIN && len <= BLESSING_REASON_MAX;

  async function submit(): Promise<void> {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await blessSkater(targetUid, reason.trim());
      setSent(true);
    } catch (err) {
      setError(blessingErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p
        role="status"
        data-testid="bless-sent"
        className="mb-4 rounded-xl border border-amber-300/30 bg-amber-300/10 px-3 py-3 font-body text-sm text-amber-100"
      >
        Sent. @{username} is on once they accept.
      </p>
    );
  }

  return (
    <div className="mb-4">
      <button
        type="button"
        data-testid="bless-pro-button"
        onClick={() => setOpen(true)}
        className="flex w-full min-h-[44px] items-center justify-center gap-2 rounded-xl border border-amber-300/40 bg-amber-300/10 font-display text-sm tracking-wider text-amber-100 hover:bg-amber-300/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-300"
      >
        <Sparkles size={14} aria-hidden="true" />
        PUT ON
      </button>
      {open && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bless-title"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center"
        >
          <div className="w-full max-w-md rounded-2xl border border-amber-300/30 bg-surface p-5 shadow-card">
            <div className="mb-3 flex items-start justify-between gap-3">
              <h2 id="bless-title" className="font-display text-lg tracking-wide text-white">
                Put @{username} on as PRO?
              </h2>
              <button
                type="button"
                aria-label="Close"
                onClick={() => setOpen(false)}
                className="min-h-[44px] min-w-[44px] text-white/60 hover:text-white"
              >
                <X size={18} aria-hidden="true" className="mx-auto" />
              </button>
            </div>
            <p className="mb-3 font-body text-sm text-white/70">
              Only for skaters who are pro for real: a board or shoe with a real company. Your name goes on their
              profile for good, and you get a couple of these a month.
            </p>
            <label htmlFor="bless-reason" className="mb-1 block font-display text-sm tracking-wider text-white/60">
              WHY (SHOWN ON THEIR PROFILE)
            </label>
            <textarea
              id="bless-reason"
              data-testid="bless-reason"
              value={reason}
              maxLength={BLESSING_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-white/10 bg-black/30 p-3 font-body text-sm text-white"
              placeholder="Filmed with them for years. Real deal."
            />
            <p className="mt-1 text-right font-body text-label text-white/50">
              {len}/{BLESSING_REASON_MAX}
            </p>
            {error && (
              <p role="alert" className="mt-2 font-body text-xs text-brand-red">
                {error}
              </p>
            )}
            <button
              type="button"
              data-testid="bless-confirm"
              disabled={!valid || busy}
              onClick={() => void submit()}
              className="mt-3 w-full min-h-[44px] rounded-xl bg-amber-300 font-display text-sm tracking-wider text-black disabled:opacity-40"
            >
              {busy ? "SENDING…" : "PUT ON"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
