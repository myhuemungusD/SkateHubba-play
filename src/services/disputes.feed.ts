/**
 * Feed query for open community disputes.
 *
 * Read-only. Reading or paging this feed never affects game state — see the
 * note in `disputes.raise.ts`: a verdict is recorded and tallied, never
 * applied to letters or turn order.
 */

import { documentId, getDocs, limit as limitFn, orderBy, query, where } from "firebase/firestore";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { parseFirebaseError } from "../utils/helpers";
import { disputesRef, toDisputeDoc, type Dispute } from "./disputes.mappers";

/** Upper bound on a single page, mirroring `runFeedQuery` in clips.feed.ts. */
const MAX_PAGE_SIZE = 50;

/**
 * Fetch the open disputes awaiting community verdicts, newest first.
 *
 * Filters `status == 'open'` AND `moderationStatus == 'active'` server-side:
 * closed disputes are history, and hidden ones are moderation removals (App
 * Store Guideline 1.2). The doc-id tiebreaker exists for the same reason as
 * the clips feed — disputes raised back-to-back can share a server timestamp,
 * and without it a future cursor would skip or duplicate rows. Paired with
 * the composite index in firestore.indexes.json:
 *   (status, moderationStatus, createdAt desc, __name__ desc)
 *
 * Per-doc try/catch so one malformed dispute can't blank the whole page.
 * The read is wrapped in `withRetry` so a transient failure doesn't surface
 * an empty feed.
 *
 * No cursor: the open set is small and short-lived by design, so this
 * returns a single bounded page. If pagination is needed later it slots in
 * exactly as `ClipsFeedCursor` does.
 */
export async function fetchOpenDisputes(pageSize = 20): Promise<Dispute[]> {
  const boundedSize = Math.max(1, Math.min(MAX_PAGE_SIZE, pageSize));

  const q = query(
    disputesRef(),
    where("status", "==", "open"),
    where("moderationStatus", "==", "active"),
    orderBy("createdAt", "desc"),
    orderBy(documentId(), "desc"),
    limitFn(boundedSize),
  );

  const snap = await withRetry(() => getDocs(q));

  const disputes: Dispute[] = [];
  for (const d of snap.docs) {
    try {
      disputes.push(toDisputeDoc(d));
    } catch (err) {
      logger.warn("disputes_feed_doc_malformed", { docId: d.id, error: parseFirebaseError(err) });
    }
  }

  return disputes;
}
