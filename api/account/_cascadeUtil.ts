/**
 * Shared building blocks for the account-erasure cascade
 * (`_deleteUserData.ts`, `_diceErasure.ts`, `_closetErasure.ts`, `_ownedContent.ts`).
 *
 * Split out of `_deleteUserData.ts` so the newer phases can reuse the same
 * paginated scan, chunked batch delete and retrying Storage delete without
 * importing the orchestrator (which imports them). Behaviour is unchanged.
 */

import { FieldPath, type Firestore, type Query } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";

/**
 * Firestore caps a batch at 500 writes. 400 leaves headroom so a future extra
 * delete per entity can't silently push a previously-fine account over the line.
 */
const BATCH_CHUNK = 400;

/**
 * Max docs pulled per query page. Deletion is unbounded in principle (a heavy
 * user can have thousands of notifications), so every scan paginates rather
 * than assuming one `get()` returns everything.
 */
const PAGE_SIZE = 500;

/** Concurrent Storage deletes. Bounded so a large account can't self-DoS on GCS limits. */
const STORAGE_DELETE_CONCURRENCY = 20;

/** Attempts per Storage object before giving up (transient codes only). */
const STORAGE_RETRY_ATTEMPTS = 3;

/** Base backoff between Storage retries; doubles per attempt. */
const STORAGE_RETRY_BASE_MS = 200;

/** Everything the cascade needs, injected so the unit tests can drive it with fakes. */
export interface CascadeDeps {
  db: Firestore;
  storage: Storage;
  /** Bucket name, e.g. `my-project.firebasestorage.app`. */
  bucketName: string;
}

/**
 * Page through a query by document id, collecting every matching doc.
 *
 * Ordering by `__name__` gives a stable cursor that does not require a
 * composite index (a `where(...) + orderBy(otherField)` pair would). The loop
 * terminates when a page comes back short of `PAGE_SIZE`.
 */
export async function scanAll(base: Query): Promise<FirebaseFirestore.QueryDocumentSnapshot[]> {
  const out: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  for (;;) {
    let page = base.orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) page = page.startAfter(cursor);
    const snap = await page.get();
    out.push(...snap.docs);
    if (snap.size < PAGE_SIZE) return out;
    cursor = snap.docs[snap.size - 1];
  }
}

/** Delete refs in chunked batches, staying under the 500-write ceiling. */
export async function deleteRefs(db: Firestore, refs: FirebaseFirestore.DocumentReference[]): Promise<number> {
  for (let i = 0; i < refs.length; i += BATCH_CHUNK) {
    const batch = db.batch();
    for (const ref of refs.slice(i, i + BATCH_CHUNK)) batch.delete(ref);
    await batch.commit();
  }
  return refs.length;
}

/** One staged non-delete write for {@link commitWrites}. */
export interface StagedWrite {
  ref: FirebaseFirestore.DocumentReference;
  /** `set` replaces the whole doc (needed when map keys are renamed); `update` patches fields. */
  kind: "set" | "update";
  data: Record<string, unknown>;
}

/** Commit set/update writes in chunked batches, same ceiling as {@link deleteRefs}. */
export async function commitWrites(db: Firestore, writes: readonly StagedWrite[]): Promise<number> {
  for (let i = 0; i < writes.length; i += BATCH_CHUNK) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + BATCH_CHUNK)) {
      if (w.kind === "set") batch.set(w.ref, w.data);
      else batch.update(w.ref, w.data);
    }
    await batch.commit();
  }
  return writes.length;
}

/** Scan `collectionName` where `field == uid` and delete every hit. */
export async function deleteWhere(db: Firestore, collectionName: string, field: string, uid: string): Promise<number> {
  const hits = await scanAll(db.collection(collectionName).where(field, "==", uid));
  return deleteRefs(
    db,
    hits.map((d) => d.ref),
  );
}

export function numField(data: Record<string, unknown>, field: string): number {
  const value = data[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export async function deleteIfPresent(db: Firestore, collectionName: string, uid: string): Promise<number> {
  const ref = db.collection(collectionName).doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return 0;
  await ref.delete();
  return 1;
}

/** Objects listed per `getFiles` page. GCS caps a page at 1000. */
const STORAGE_LIST_PAGE_SIZE = 1000;

/**
 * Delete every object under a Storage prefix.
 *
 * Lists one page at a time (`autoPaginate: false` + `pageToken`) so a heavy
 * prefix never has to sit in memory as one array, and so every page is
 * provably visited. GCS page tokens are positional (lexicographic), so
 * deleting a page before fetching the next one does not skip objects. A
 * missing prefix is not an error — it resolves with nothing deleted, which is
 * exactly the resumed-run case.
 *
 * A list or delete failure throws. The caller turns that into
 * `erasure_failed` and never reports success.
 */
export async function deletePrefix(deps: CascadeDeps, prefix: string): Promise<number> {
  const bucket = deps.storage.bucket(deps.bucketName);
  let deleted = 0;
  let pageToken: string | undefined;
  do {
    const [files, nextQuery] = await bucket.getFiles({
      prefix,
      autoPaginate: false,
      maxResults: STORAGE_LIST_PAGE_SIZE,
      ...(pageToken ? { pageToken } : {}),
    });
    // Bounded fan-out. A heavy account (many finished games x turns) can hold
    // hundreds of objects; firing every delete at once invites GCS rate limits,
    // and because this phase runs first, a single 429 would abort the cascade
    // before any Firestore document is touched — every retry replaying the same
    // burst. Chunking keeps a big account deletable.
    for (let i = 0; i < files.length; i += STORAGE_DELETE_CONCURRENCY) {
      const chunk = files.slice(i, i + STORAGE_DELETE_CONCURRENCY);
      await Promise.all(chunk.map((f) => withStorageRetry(() => f.delete({ ignoreNotFound: true }))));
    }
    deleted += files.length;
    const next = (nextQuery as { pageToken?: unknown } | null | undefined)?.pageToken;
    pageToken = typeof next === "string" && next.length > 0 ? next : undefined;
  } while (pageToken !== undefined);
  return deleted;
}

/**
 * The Storage folder that belongs to one account: `users/{uid}/`.
 *
 * Everything the app or a Firebase extension writes for a profile lives here:
 * `avatar.{webp,jpeg,png}`, `banner.webp`, and the Resize Images extension's
 * `avatar_200x200.webp` / `banner_200x200.webp` thumbnails (G8). Deleting the
 * whole folder means a new extension size or output subfolder is covered
 * without another code change.
 *
 * The trailing `/` is load-bearing: GCS prefixes are plain string prefixes,
 * so `users/abc` would also match `users/abcd/...` — another account. A uid
 * that is empty or holds a `/` is refused outright, since either would widen
 * the prefix beyond one account (an empty uid gives `users//`, a uid like
 * `a/..` is not a Firebase uid at all).
 */
export function userStoragePrefix(uid: string): string {
  if (typeof uid !== "string" || uid.length === 0 || uid.includes("/")) {
    throw new Error("userStoragePrefix: refusing an empty or path-like uid");
  }
  return `users/${uid}/`;
}

/**
 * Retry a Storage operation through transient GCS failures.
 *
 * Deliberately narrow: only rate-limit and availability codes retry. A
 * permissions or bad-bucket failure must still throw, because silently
 * continuing would erase the Firestore records while leaving the binaries —
 * the exact privacy failure this cascade exists to prevent.
 */
async function withStorageRetry<T>(op: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < STORAGE_RETRY_ATTEMPTS; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: unknown } | null)?.code;
      const retryable = code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
      if (!retryable || attempt === STORAGE_RETRY_ATTEMPTS - 1) throw err;
      await new Promise((r) => setTimeout(r, STORAGE_RETRY_BASE_MS * 2 ** attempt));
    }
  }
  throw lastErr;
}
