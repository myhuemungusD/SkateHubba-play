/**
 * One feed page for the clips lane, following the cursor past windows that
 * hold no new user posts (see MAX_EMPTY_FOLLOWS).
 */

import { fetchClipsFeed, type ClipsFeedCursor, type ClipsFeedSort } from "../../services/clips";

const PAGE_SIZE = 12;
// The service scans a bounded number of raw pages, so a run of game clips can
// return nothing new plus a cursor: follow it up to this many more times. A
// cursor that didn't move (top-index fallback re-serves page one) ends the feed.
const MAX_EMPTY_FOLLOWS = 3;
const moved = (from: ClipsFeedCursor | null, to: ClipsFeedCursor | null): to is ClipsFeedCursor =>
  to !== null && to.id !== from?.id;

export async function fetchFeedPage(cursor: ClipsFeedCursor | null, sort: ClipsFeedSort, known: ReadonlySet<string>) {
  let from = cursor;
  let page = await fetchClipsFeed(from, PAGE_SIZE, sort);
  for (let i = 0; i < MAX_EMPTY_FOLLOWS && moved(from, page.cursor) && !page.clips.some((c) => !known.has(c.id)); i++) {
    from = page.cursor;
    page = await fetchClipsFeed(from, PAGE_SIZE, sort);
  }
  return { ...page, more: moved(from, page.cursor) };
}
