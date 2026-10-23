import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { ActionMenu } from "../../../components/ui/ActionMenu";
import { ConfirmSheet } from "../../../components/ui/ConfirmSheet";

const ReportModal = lazy(() => import("../../../components/ReportModal").then((m) => ({ default: m.ReportModal })));

interface Props {
  reporterUid: string;
  reportedUid: string;
  username: string;
  isBlocked: boolean;
  blockLoading: boolean;
  showBlockConfirm: boolean;
  onOpenBlockConfirm: () => void;
  onCancelBlockConfirm: () => void;
  onConfirmBlock: () => void;
  onUnblock: () => void;
}

/**
 * The ••• in the header of someone else's profile: Report and Block / Unblock.
 *
 * App Review 1.2 wants a way to flag a user, not only their content, and a
 * way to block them. Both stay one tap from the profile, but in the menu
 * every social app uses rather than as bare text lines under Challenge.
 * Reports go into the same moderator queue as every other report, as a
 * profile-target report (no game, clip or spot).
 */
export function PlayerSafetyMenu({
  reporterUid,
  reportedUid,
  username,
  isBlocked,
  blockLoading,
  showBlockConfirm,
  onOpenBlockConfirm,
  onCancelBlockConfirm,
  onConfirmBlock,
  onUnblock,
}: Props) {
  const [reporting, setReporting] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const wasReporting = useRef(false);
  // Hand focus back to ••• once the report closes. In an effect, so it runs
  // after the modal's own focus-trap cleanup: the lazy modal can first render
  // while the menu's Report button still has focus, so its trap cannot be
  // relied on to know the opener.
  useEffect(() => {
    if (wasReporting.current && !reporting) moreRef.current?.focus();
    wasReporting.current = reporting;
  }, [reporting]);
  return (
    <>
      <ActionMenu
        label={`More options for @${username}`}
        triggerRef={moreRef}
        items={[
          { label: "Report", destructive: true, onSelect: () => setReporting(true) },
          isBlocked
            ? { label: "Unblock", disabled: blockLoading, onSelect: onUnblock }
            : { label: "Block", destructive: true, onSelect: onOpenBlockConfirm },
        ]}
      />
      {showBlockConfirm && !isBlocked && (
        <ConfirmSheet
          title={`Block @${username}?`}
          body="They won't be able to challenge you, and you won't see their clips."
          confirmLabel={blockLoading ? "Blocking…" : "Block"}
          cancelLabel="Cancel"
          busy={blockLoading}
          onConfirm={onConfirmBlock}
          onCancel={onCancelBlockConfirm}
        />
      )}
      {reporting && (
        <Suspense fallback={null}>
          <ReportModal
            reporterUid={reporterUid}
            reportedUid={reportedUid}
            reportedUsername={username}
            gameId={null}
            profile
            onClose={() => setReporting(false)}
            onSubmitted={() => setReporting(false)}
          />
        </Suspense>
      )}
    </>
  );
}
