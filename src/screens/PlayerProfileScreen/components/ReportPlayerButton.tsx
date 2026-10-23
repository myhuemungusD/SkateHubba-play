import { lazy, Suspense, useState } from "react";

const ReportModal = lazy(() => import("../../../components/ReportModal").then((m) => ({ default: m.ReportModal })));

interface Props {
  reporterUid: string;
  reportedUid: string;
  username: string;
}

/**
 * "Report this player" on someone else's profile.
 *
 * App Review 1.2 wants a way to flag a user, not only their content: abuse in
 * a bio, a handle, or a pattern across games has no single clip to point at.
 * The report goes into the same moderator queue as every other report, as a
 * profile-target report (no game, clip or spot).
 */
export function ReportPlayerButton({ reporterUid, reportedUid, username }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="touch-target -mt-6 mb-8 inline-flex items-center justify-center font-body text-xs text-subtle hover:text-brand-red transition-colors"
      >
        Report this player
      </button>
      {open && (
        <Suspense fallback={null}>
          <ReportModal
            reporterUid={reporterUid}
            reportedUid={reportedUid}
            reportedUsername={username}
            gameId={null}
            profile
            onClose={() => setOpen(false)}
            onSubmitted={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}
