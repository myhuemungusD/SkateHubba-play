import { lazy, Suspense } from "react";
import type { ClipDoc } from "../../services/clips";
import type { ClipComment } from "../../services/clips.comments";
import type { Dispute } from "../../types/dispute";

/** One clip comment picked for a report from the comments sheet. */
export interface CommentReportTarget {
  clip: ClipDoc;
  comment: ClipComment;
}

const ReportModal = lazy(() => import("../ReportModal").then((m) => ({ default: m.ReportModal })));
const UserClipUploadModal = lazy(() => import("../UserClipUpload").then((m) => ({ default: m.UserClipUploadModal })));
const ClipComments = lazy(() => import("./ClipComments").then((m) => ({ default: m.ClipComments })));

interface FeedModalsProps {
  uid: string;
  username: string;
  blockedUids: ReadonlySet<string>;
  // Comments
  commentsTarget: ClipDoc | null;
  onCloseComments: () => void;
  onReportFromComments: (clip: ClipDoc) => void;
  onReportComment: (target: CommentReportTarget) => void;
  onViewPlayer: (uid: string) => void;
  // Upload
  uploadOpen: boolean;
  onCloseUpload: () => void;
  onPosted: () => void;
  // Report (dispute)
  disputeReport: Dispute | null;
  onCloseDisputeReport: () => void;
  // Report (clip)
  reportTarget: ClipDoc | null;
  onCloseClipReport: () => void;
  onClipReportSubmitted: (clip: ClipDoc) => void;
  // Report (single comment)
  commentReport: CommentReportTarget | null;
  onCloseCommentReport: () => void;
}

/**
 * Renders all feed modals: comments, upload, and report.
 * Extracted from ClipsFeed to reduce LOC.
 */
export function FeedModals({
  uid,
  username,
  blockedUids,
  commentsTarget,
  onCloseComments,
  onReportFromComments,
  onReportComment,
  onViewPlayer,
  uploadOpen,
  onCloseUpload,
  onPosted,
  disputeReport,
  onCloseDisputeReport,
  reportTarget,
  onCloseClipReport,
  onClipReportSubmitted,
  commentReport,
  onCloseCommentReport,
}: FeedModalsProps) {
  return (
    <>
      {commentsTarget && (
        <Suspense fallback={null}>
          <ClipComments
            key={commentsTarget.id}
            clip={commentsTarget}
            viewerUid={uid}
            viewerUsername={username}
            blockedUids={blockedUids}
            onClose={onCloseComments}
            onReport={() => onReportFromComments(commentsTarget)}
            onReportComment={(comment) => onReportComment({ clip: commentsTarget, comment })}
            onViewPlayer={onViewPlayer}
          />
        </Suspense>
      )}

      {uploadOpen && (
        <Suspense fallback={null}>
          <UserClipUploadModal uid={uid} username={username} onClose={onCloseUpload} onPosted={onPosted} />
        </Suspense>
      )}

      {disputeReport && (
        <Suspense fallback={null}>
          <ReportModal
            reporterUid={uid}
            reportedUid={disputeReport.matcherUid}
            reportedUsername={disputeReport.matcherUsername}
            gameId={disputeReport.gameId}
            disputeId={disputeReport.id}
            onClose={onCloseDisputeReport}
            onSubmitted={onCloseDisputeReport}
          />
        </Suspense>
      )}

      {reportTarget && (
        <Suspense fallback={null}>
          <ReportModal
            reporterUid={uid}
            reportedUid={reportTarget.playerUid}
            reportedUsername={reportTarget.playerUsername}
            gameId={reportTarget.gameId}
            clipId={reportTarget.id}
            onClose={onCloseClipReport}
            onSubmitted={() => onClipReportSubmitted(reportTarget)}
          />
        </Suspense>
      )}
      {commentReport && (
        <Suspense fallback={null}>
          <ReportModal
            reporterUid={uid}
            reportedUid={commentReport.comment.userId}
            reportedUsername={commentReport.comment.username}
            gameId={commentReport.clip.gameId}
            clipId={commentReport.clip.id}
            comment={{ id: commentReport.comment.id, text: commentReport.comment.text }}
            onClose={onCloseCommentReport}
            onSubmitted={onCloseCommentReport}
          />
        </Suspense>
      )}
    </>
  );
}
