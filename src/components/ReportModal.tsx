import { useState, useId, useRef } from "react";
import { Btn } from "./ui/Btn";
import { ErrorBanner } from "./ui/ErrorBanner";
import {
  submitReport,
  REPORT_REASON_LABELS,
  ILLEGAL_CONTENT_MIN_EXPLANATION,
  type ReportReason,
} from "../services/reports";
import { useFocusTrap } from "../hooks/useFocusTrap";

const REASONS = Object.keys(REPORT_REASON_LABELS) as ReportReason[];

export function ReportModal({
  reporterUid,
  reportedUid,
  reportedUsername,
  gameId,
  clipId,
  disputeId,
  onClose,
  onSubmitted,
}: {
  reporterUid: string;
  reportedUid: string;
  reportedUsername: string;
  /**
   * Game the report is filed from. Optional: a user-posted clip belongs to no
   * game, and inventing an id for it would put a dead reference in front of a
   * moderator. Omitted (or null) reports are surfaced as clip-only in the
   * admin queue.
   */
  gameId?: string | null;
  /** Clip id when reporting a feed clip; omit for game-level reports. */
  clipId?: string;
  /** Community dispute id. These reports stay in the admin queue and do not auto-hide. */
  disputeId?: string;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const [reason, setReason] = useState<ReportReason | "">("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const selectId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef);

  const handleSubmit = async () => {
    if (!reason) {
      setError("Please select a reason.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const id = await submitReport({
        reporterUid,
        reportedUid,
        reportedUsername,
        gameId: gameId ?? null,
        reason,
        description,
        ...(clipId ? { clipId } : {}),
        ...(disputeId ? { disputeId } : {}),
      });
      setReceiptId(id);
      setSubmitting(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to submit report");
      setSubmitting(false);
    }
  };

  const illegal = reason === "illegal_content";
  const detailsLabel = illegal ? "EXPLANATION (REQUIRED)" : "DETAILS (OPTIONAL)";

  if (receiptId) {
    return (
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-6 z-50"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-modal-title"
        onClick={onSubmitted}
        onKeyDown={(e) => {
          if (e.key === "Escape") onSubmitted();
        }}
      >
        <div
          ref={panelRef}
          className="glass-card rounded-2xl p-6 max-w-sm w-full animate-scale-in"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 id="report-modal-title" className="font-display text-xl text-white mb-1">
            We received your report
          </h3>
          <p className="font-body text-sm text-muted mb-2">
            We&apos;ll review it. You can check the status in Settings.
          </p>
          <p className="font-body text-sm text-white mb-4" data-testid="report-receipt-id">
            Reference {receiptId}
          </p>
          <Btn onClick={onSubmitted} variant="primary" autoFocus>
            Done
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center p-6 z-50"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
      onClick={() => {
        if (!submitting) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !submitting) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="glass-card rounded-2xl p-6 max-w-sm w-full animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="report-modal-title" className="font-display text-xl text-white mb-1">
          Report @{reportedUsername}
        </h3>
        <p className="font-body text-sm text-muted mb-4">
          Help keep SkateHubba safe. Reports are reviewed by our team and kept confidential.
        </p>

        {/* Reason select */}
        <div className="mb-4">
          <label htmlFor={selectId} className="block font-display text-sm tracking-[0.12em] text-dim mb-2">
            REASON
          </label>
          <select
            id={selectId}
            value={reason}
            onChange={(e) => setReason(e.target.value as ReportReason | "")}
            disabled={submitting}
            className="w-full bg-surface-alt/80 backdrop-blur-sm border border-border rounded-2xl text-white text-base font-body outline-none px-4 py-3.5 focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1)] transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed appearance-none"
          >
            <option value="" disabled>
              Select a reason...
            </option>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {REPORT_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        {/* Description */}
        <div className="mb-4">
          <label htmlFor={descId} className="block font-display text-sm tracking-[0.12em] text-dim mb-2">
            {detailsLabel}
          </label>
          <textarea
            id={descId}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what happened..."
            maxLength={500}
            rows={3}
            disabled={submitting}
            className="w-full bg-surface-alt/80 backdrop-blur-sm border border-border rounded-2xl text-white text-base font-body outline-none px-4 py-3.5 focus:border-brand-orange focus:shadow-[0_0_0_3px_rgba(255,107,0,0.1)] transition-all duration-300 disabled:opacity-40 disabled:cursor-not-allowed resize-none placeholder:text-subtle/60"
          />
          <span className="text-xs text-faint mt-1 block font-body">{description.length}/500</span>
        </div>

        {error && <ErrorBanner message={error} onDismiss={() => setError("")} />}

        <div className="flex gap-3 mt-2">
          <Btn
            onClick={() => {
              setError("");
              onClose();
            }}
            variant="secondary"
            disabled={submitting}
            autoFocus
          >
            Cancel
          </Btn>
          <Btn
            onClick={handleSubmit}
            variant="danger"
            disabled={submitting || !reason || (illegal && description.trim().length < ILLEGAL_CONTENT_MIN_EXPLANATION)}
          >
            {submitting ? "Sending..." : "Submit Report"}
          </Btn>
        </div>
      </div>
    </div>
  );
}
