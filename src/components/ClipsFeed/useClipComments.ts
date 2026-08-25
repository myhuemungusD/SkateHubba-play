/**
 * Load / post / delete for one clip's comment thread.
 *
 * Same split as `useClipsFeedController`: state and writes here, JSX in
 * `ClipComments.tsx`. Scoped to a single clip — the sheet is mounted with a
 * `key={clip.id}`, so switching clips gets a fresh thread rather than a
 * partially-migrated one.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CLIP_COMMENT_MAX_LENGTH,
  createClipComment,
  deleteClipComment,
  fetchClipComments,
  type ClipComment,
} from "../../services/clips.comments";
import { logger } from "../../services/logger";
import { parseFirebaseError } from "../../utils/helpers";

/**
 * Hard cap on a comment. Re-exported from the service's constant rather than
 * restated, so the composer's counter and the write's validation can never
 * disagree about what "too long" means.
 */
export const COMMENT_MAX_LENGTH = CLIP_COMMENT_MAX_LENGTH;

export interface ClipCommentsController {
  comments: ClipComment[];
  loading: boolean;
  error: string;
  draft: string;
  setDraft: (text: string) => void;
  submit: () => Promise<void>;
  /** True while the draft is being posted. */
  posting: boolean;
  /** Id of the comment currently being deleted, or null. */
  deletingId: string | null;
  remove: (comment: ClipComment) => Promise<void>;
  /** True when `submit` would be accepted. */
  canSubmit: boolean;
  reload: () => Promise<void>;
}

/** Trim, then check against the cap. Whitespace is not a comment. */
export function isPostableComment(draft: string): boolean {
  const trimmed = draft.trim();
  return trimmed.length > 0 && trimmed.length <= COMMENT_MAX_LENGTH;
}

export function useClipComments(clipId: string, viewerUid: string, viewerUsername: string): ClipCommentsController {
  const [comments, setComments] = useState<ClipComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError("");
    try {
      // First page only. The sheet shows the newest comments (the service
      // orders `createdAt` desc); paging further is deliberately out of scope
      // here — a "load more" affordance can hang off `page.cursor` later
      // without changing this shape.
      const page = await fetchClipComments(clipId);
      if (!mountedRef.current) return;
      setComments(page.comments);
    } catch (err) {
      logger.warn("clip_comments_load_failed", { clipId, error: parseFirebaseError(err) });
      if (!mountedRef.current) return;
      setError("Couldn't load comments. Try again.");
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [clipId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canSubmit = isPostableComment(draft) && !posting;

  const submit = useCallback(async (): Promise<void> => {
    const text = draft.trim();
    if (!isPostableComment(draft)) return;
    setPosting(true);
    setError("");
    try {
      const created = await createClipComment(viewerUid, viewerUsername, clipId, text);
      if (!mountedRef.current) return;
      // Prepend rather than refetch: the thread reads newest-first, so a new
      // comment belongs at the top, and a refetch would cost a full read set
      // to learn something we already know. Its `createdAt` is null until the
      // server stamp lands — `relativeClipTime` renders that as blank, which
      // is why the row doesn't claim a time it doesn't have.
      setComments((prev) => [created, ...prev]);
      setDraft("");
    } catch (err) {
      logger.warn("clip_comment_create_failed", { clipId, error: parseFirebaseError(err) });
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : "Couldn't post that comment.");
    } finally {
      if (mountedRef.current) setPosting(false);
    }
  }, [draft, clipId, viewerUid, viewerUsername]);

  const remove = useCallback(
    async (comment: ClipComment): Promise<void> => {
      // Authorship is enforced by firestore.rules; this guard keeps a
      // mis-wired caller from firing a write that can only be denied.
      if (comment.userId !== viewerUid) return;
      setDeletingId(comment.id);
      setError("");
      try {
        await deleteClipComment(viewerUid, clipId, comment.id);
        if (!mountedRef.current) return;
        setComments((prev) => prev.filter((c) => c.id !== comment.id));
      } catch (err) {
        logger.warn("clip_comment_delete_failed", { clipId, error: parseFirebaseError(err) });
        if (!mountedRef.current) return;
        setError("Couldn't delete that comment.");
      } finally {
        if (mountedRef.current) setDeletingId(null);
      }
    },
    [clipId, viewerUid],
  );

  return {
    comments,
    loading,
    error,
    draft,
    setDraft,
    submit,
    posting,
    deletingId,
    remove,
    canSubmit,
    reload,
  };
}
