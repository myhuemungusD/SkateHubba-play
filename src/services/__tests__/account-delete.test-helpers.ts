/**
 * Shared harness for the account-deletion endpoint tests
 * (`api/account/delete.ts` + `api/account/_deleteUserData.ts`).
 *
 * Two things live here:
 *
 *   1. A request double for the handler, mirroring `cron.test-helpers.ts` but
 *      POST-by-default and able to carry a body/query — the handler must prove
 *      it ignores both, so the doubles have to be able to lie to it.
 *   2. An in-memory Firestore + Storage pair for the cascade. The cascade's
 *      whole contract is about ORDER (videos before the game doc, data before
 *      Auth) and SCOPE (which fields are queried, which docs survive), so the
 *      fake records an append-only `events` log and every `where()` it is
 *      handed rather than just returning canned snapshots.
 *
 * Not production code; excluded from coverage by the `*test-helpers*` pattern
 * in vite.config.ts.
 */

import type { Firestore } from "firebase-admin/firestore";
import type { Storage } from "firebase-admin/storage";
import type { CascadeDeps } from "../../../api/account/_deleteUserData.js";

// ── Handler request double ─────────────────────────────────────────────────

export interface AccountRequestOpts {
  /** Defaults to POST — the only verb the endpoint accepts. */
  method?: string;
  /** Omitted entirely when undefined, which exercises the fail-closed path. */
  authorization?: string | string[];
  /** Header casing to send under. Node lowercases, but proxies vary. */
  headerName?: "authorization" | "Authorization";
  /** Present so a test can prove a caller-supplied identity is ignored. */
  body?: unknown;
  query?: Record<string, string>;
  /** Cross-origin caller. Omitted entirely when undefined (same-origin). */
  origin?: string | string[];
  originHeaderName?: "origin" | "Origin";
}

export interface AccountRequestDouble {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  query?: Record<string, string>;
}

/**
 * Build a request double. An explicit `method: undefined` omits the verb
 * entirely (a platform that didn't populate it); omitting the key defaults to
 * POST. Same for `authorization`, so the fail-closed path is reachable.
 */
export function makeAccountReq(opts: AccountRequestOpts = {}): AccountRequestDouble {
  const method = "method" in opts ? opts.method : "POST";
  const headers: Record<string, string | string[] | undefined> = {};
  if (opts.authorization !== undefined) headers[opts.headerName ?? "authorization"] = opts.authorization;
  if (opts.origin !== undefined) headers[opts.originHeaderName ?? "origin"] = opts.origin;
  return { method, headers, body: opts.body, query: opts.query };
}

// ── Handler response double ────────────────────────────────────────────────

/** Everything the handler wrote back, including CORS headers. */
export interface AccountResponseCapture {
  code?: number;
  body?: Record<string, unknown> | null;
  headers: Record<string, string>;
  /** True once `res.end()` was called — how a 204 preflight terminates. */
  ended: boolean;
}

export interface AccountResponseDouble {
  status: (code: number) => AccountResponseDouble;
  json: (body: unknown) => void;
  setHeader: (name: string, value: string) => void;
  end?: () => void;
}

/**
 * Response double that records status, body and headers.
 *
 * Separate from `cron.test-helpers`' `makeRes` because this endpoint sets CORS
 * headers and answers preflights with `end()` — a double without those crashes
 * the handler instead of testing it. Pass `withEnd: false` to model a platform
 * whose response object has no `end`, which the handler falls back on.
 */
export function makeAccountRes(withEnd = true): { res: AccountResponseDouble; out: AccountResponseCapture } {
  const out: AccountResponseCapture = { headers: {}, ended: false };
  const res: AccountResponseDouble = {
    setHeader: (name: string, value: string) => void (out.headers[name] = value),
    status: (code: number) => {
      out.code = code;
      return res;
    },
    json: (body: unknown) => void (out.body = body as Record<string, unknown> | null),
  };
  if (withEnd) res.end = () => void (out.ended = true);
  return { res, out };
}

// ── Fake Firestore / Storage ───────────────────────────────────────────────

export type DocData = Record<string, unknown>;
/** Seed shape: collection path (`users/u1/achievements` for a subcollection) → id → data. */
export type Seed = Record<string, Record<string, DocData>>;

export interface WhereCall {
  collection: string;
  field: string;
  op: string;
  value: unknown;
}

export interface FakeDocSnap {
  id: string;
  ref: FakeDocRef;
  exists: boolean;
  data(): DocData | undefined;
}

export interface FakeDocRef {
  path: string;
  id: string;
  get(): Promise<FakeDocSnap>;
  delete(): Promise<void>;
  collection(name: string): FakeCollectionRef;
}

export interface FakeQuerySnap {
  docs: FakeDocSnap[];
  size: number;
  empty: boolean;
}

export interface FakeQuery {
  where(field: string, op: string, value: unknown): FakeQuery;
  orderBy(field: unknown): FakeQuery;
  limit(n: number): FakeQuery;
  startAfter(snap: FakeDocSnap): FakeQuery;
  get(): Promise<FakeQuerySnap>;
}

export interface FakeCollectionRef extends FakeQuery {
  doc(id: string): FakeDocRef;
}

export interface FakeTransaction {
  get(ref: FakeDocRef): Promise<FakeDocSnap>;
  delete(ref: FakeDocRef): void;
  update(ref: FakeDocRef, data: DocData): void;
  set(ref: FakeDocRef, data: DocData, options?: { merge?: boolean }): void;
}

export interface FakeBatch {
  delete(ref: FakeDocRef): void;
  set(ref: FakeDocRef, data: DocData): void;
  update(ref: FakeDocRef, data: DocData): void;
  commit(): Promise<void>;
}

export interface FakeDb {
  collection(name: string): FakeCollectionRef;
  /** Every doc whose parent collection id is `name`, at any depth. */
  collectionGroup(name: string): FakeQuery;
  batch(): FakeBatch;
  runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T>;
}

export interface FakeFile {
  name: string;
  delete(opts?: { ignoreNotFound?: boolean }): Promise<void>;
}

export interface FakeStorage {
  bucket(name: string): {
    getFiles(opts: GetFilesOpts): Promise<[FakeFile[], { pageToken: string } | null]>;
  };
}

export interface GetFilesOpts {
  prefix: string;
  autoPaginate?: boolean;
  maxResults?: number;
  pageToken?: string;
}

export interface FakeStore {
  /** Live documents, keyed `collectionPath/id`. Survivors are read straight off this. */
  docs: Map<string, DocData>;
  /** Live Storage object names. */
  objects: Set<string>;
  /** Append-only side-effect log — the only way to assert cross-phase ordering. */
  events: string[];
  wheres: WhereCall[];
  orderBys: unknown[];
  /** One entry per committed batch, holding that batch's write count. */
  commitSizes: number[];
  /** One entry per query page fetched, holding the collection path. */
  pageRequests: string[];
  txUpdates: { path: string; data: DocData }[];
  /** One entry per SUCCESSFUL object delete. */
  fileDeletes: { name: string; ignoreNotFound: boolean }[];
  /** One entry per delete ATTEMPT, including the ones that threw. */
  fileDeleteAttempts: string[];
  /** High-water mark of simultaneously in-flight object deletes. */
  maxConcurrentFileDeletes: number;
  bucketsRequested: string[];
  /** Set to make the next `batch().commit()` reject — the fail-loud path. */
  failNextCommit: string | null;
  /** Set to make `getFiles` reject for any prefix starting with this value. */
  failGetFilesPrefix: string | null;
  /**
   * Caps the objects returned per `getFiles` page (on top of `maxResults`),
   * so tests can force the pagination path without seeding 1000+ objects.
   */
  getFilesPageSize: number | null;
  /** Every `getFiles` call's options, in order. */
  getFilesCalls: GetFilesOpts[];
  /**
   * Called before each object delete with the object name and its 0-based
   * attempt number; return an error to throw, or null to let it succeed. Drives
   * the Storage retry/backoff tests.
   */
  failFileDelete: ((name: string, attempt: number) => unknown | null) | null;
  db: FakeDb;
  storage: FakeStorage;
  /** Pre-cast deps, so tests don't repeat the cast on every call. */
  deps: CascadeDeps;
}

export const FAKE_BUCKET = "demo.firebasestorage.app";

/** Ids directly under `collectionPath` (never grandchildren), sorted like Firestore's `__name__`. */
function childIds(docs: Map<string, DocData>, collectionPath: string): string[] {
  const prefix = `${collectionPath}/`;
  const out: string[] = [];
  for (const path of docs.keys()) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    if (rest.includes("/")) continue;
    out.push(rest);
  }
  return out.sort();
}

/** Paths of docs whose immediate parent collection id is `group`, sorted by full path. */
function groupPaths(docs: Map<string, DocData>, group: string): string[] {
  const out: string[] = [];
  for (const path of docs.keys()) {
    const segs = path.split("/");
    if (segs[segs.length - 2] === group) out.push(path);
  }
  return out.sort();
}

interface QueryState {
  wheres: { field: string; op: string; value: unknown }[];
  limit: number | null;
  /** Full path of the cursor doc. */
  startAfterPath: string | null;
}

function matches(data: DocData, w: { field: string; op: string; value: unknown }): boolean {
  if (w.op === "array-contains") return Array.isArray(data[w.field]) && (data[w.field] as unknown[]).includes(w.value);
  return data[w.field] === w.value;
}

/**
 * Build an in-memory Firestore + Storage pair.
 *
 * Semantics that matter to the cascade and are therefore modelled faithfully:
 * equality filters, `__name__` ordering with a `startAfter` cursor and a page
 * limit, batched deletes that only land at `commit()`, and transaction writes
 * that only land after the callback resolves.
 */
export function makeFakeStore(seed: Seed = {}, objects: string[] = []): FakeStore {
  const docs = new Map<string, DocData>();
  for (const [collectionPath, byId] of Object.entries(seed)) {
    for (const [id, data] of Object.entries(byId)) docs.set(`${collectionPath}/${id}`, data);
  }

  const store: FakeStore = {
    docs,
    objects: new Set(objects),
    events: [],
    wheres: [],
    orderBys: [],
    commitSizes: [],
    pageRequests: [],
    txUpdates: [],
    fileDeletes: [],
    fileDeleteAttempts: [],
    maxConcurrentFileDeletes: 0,
    bucketsRequested: [],
    getFilesPageSize: null,
    getFilesCalls: [],
    failNextCommit: null,
    failGetFilesPrefix: null,
    failFileDelete: null,
    // Assigned immediately below; the graph is cyclic (refs need the store).
    db: null as unknown as FakeDb,
    storage: null as unknown as FakeStorage,
    deps: null as unknown as CascadeDeps,
  };

  const snapOf = (collectionPath: string, id: string): FakeDocSnap => {
    const data = store.docs.get(`${collectionPath}/${id}`);
    return { id, ref: docRef(collectionPath, id), exists: data !== undefined, data: () => data };
  };

  const snapOfPath = (path: string): FakeDocSnap => {
    const cut = path.lastIndexOf("/");
    return snapOf(path.slice(0, cut), path.slice(cut + 1));
  };

  const docRef = (collectionPath: string, id: string): FakeDocRef => {
    const path = `${collectionPath}/${id}`;
    return {
      path,
      id,
      get: () => Promise.resolve(snapOf(collectionPath, id)),
      delete: () => {
        store.events.push(`delete:${path}`);
        store.docs.delete(path);
        return Promise.resolve();
      },
      collection: (name: string) => collectionRef(`${path}/${name}`),
    };
  };

  /** `list` returns the candidate doc paths for this query (a collection or a group). */
  const query = (label: string, list: () => string[], state: QueryState): FakeQuery => ({
    where: (field, op, value) => {
      store.wheres.push({ collection: label, field, op, value });
      return query(label, list, { ...state, wheres: [...state.wheres, { field, op, value }] });
    },
    orderBy: (field) => {
      store.orderBys.push(field);
      return query(label, list, state);
    },
    limit: (n) => query(label, list, { ...state, limit: n }),
    startAfter: (snap) => query(label, list, { ...state, startAfterPath: snap.ref.path }),
    get: () => {
      store.pageRequests.push(label);
      let paths = list().filter((path) => {
        const data = store.docs.get(path) ?? {};
        return state.wheres.every((w) => matches(data, w));
      });
      const after = state.startAfterPath;
      if (after !== null) paths = paths.filter((path) => path > after);
      if (state.limit !== null) paths = paths.slice(0, state.limit);
      const pageDocs = paths.map((path) => snapOfPath(path));
      return Promise.resolve({ docs: pageDocs, size: pageDocs.length, empty: pageDocs.length === 0 });
    },
  });

  const collectionRef = (collectionPath: string): FakeCollectionRef => ({
    ...query(collectionPath, () => childIds(store.docs, collectionPath).map((id) => `${collectionPath}/${id}`), {
      wheres: [],
      limit: null,
      startAfterPath: null,
    }),
    doc: (id: string) => docRef(collectionPath, id),
  });

  store.db = {
    collection: collectionRef,
    collectionGroup: (name: string) =>
      query(`group:${name}`, () => groupPaths(store.docs, name), { wheres: [], limit: null, startAfterPath: null }),
    batch: () => {
      const staged: { ref: FakeDocRef; kind: "delete" | "set" | "update"; data?: DocData }[] = [];
      return {
        delete: (ref) => void staged.push({ ref, kind: "delete" }),
        set: (ref, data) => void staged.push({ ref, kind: "set", data }),
        update: (ref, data) => void staged.push({ ref, kind: "update", data }),
        commit: () => {
          const failure = store.failNextCommit;
          if (failure !== null) {
            store.failNextCommit = null;
            return Promise.reject(new Error(failure));
          }
          store.commitSizes.push(staged.length);
          for (const { ref, kind, data } of staged) {
            store.events.push(`${kind}:${ref.path}`);
            if (kind === "delete") store.docs.delete(ref.path);
            else if (kind === "set") store.docs.set(ref.path, { ...data });
            else {
              const current = store.docs.get(ref.path);
              // Firestore rejects an update to a missing doc; so does the fake.
              if (!current) return Promise.reject(new Error(`update on missing doc ${ref.path}`));
              store.docs.set(ref.path, { ...current, ...data });
            }
          }
          store.events.push(`commit:${staged.length}`);
          return Promise.resolve();
        },
      };
    },
    runTransaction: async <T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> => {
      const staged: (() => void)[] = [];
      store.events.push("tx:begin");
      const result = await fn({
        get: (ref) => {
          store.events.push(`tx:get:${ref.path}`);
          return Promise.resolve(snapOfPath(ref.path));
        },
        delete: (ref) =>
          void staged.push(() => {
            store.events.push(`tx:delete:${ref.path}`);
            store.docs.delete(ref.path);
          }),
        update: (ref, data) =>
          void staged.push(() => {
            store.events.push(`tx:update:${ref.path}`);
            store.txUpdates.push({ path: ref.path, data });
            const current = store.docs.get(ref.path);
            if (current) store.docs.set(ref.path, { ...current, ...data });
          }),
        set: (ref, data, options) =>
          void staged.push(() => {
            store.events.push(`tx:set:${ref.path}`);
            const current = options?.merge ? store.docs.get(ref.path) : undefined;
            store.docs.set(ref.path, { ...(current ?? {}), ...data });
          }),
      });
      for (const apply of staged) apply();
      store.events.push("tx:commit");
      return result;
    },
  };

  let inFlight = 0;
  store.storage = {
    bucket: (name: string) => {
      store.bucketsRequested.push(name);
      return {
        getFiles: (opts) => {
          const { prefix, pageToken } = opts;
          store.getFilesCalls.push({ ...opts });
          store.events.push(`getFiles:${prefix}`);
          const failPrefix = store.failGetFilesPrefix;
          if (failPrefix !== null && prefix.startsWith(failPrefix)) {
            return Promise.reject(new Error(`storage list failed: ${prefix}`));
          }
          // Real GCS semantics: a page token is the position after the last
          // name returned, so objects deleted from earlier pages never shift
          // the next page. With autoPaginate left on, everything comes back.
          const matching = [...store.objects]
            .filter((objectName) => objectName.startsWith(prefix))
            .filter((objectName) => pageToken === undefined || objectName > pageToken)
            .sort();
          const caps = [
            opts.autoPaginate === false ? opts.maxResults : undefined,
            store.getFilesPageSize ?? undefined,
          ].filter((n): n is number => typeof n === "number");
          const limit = caps.length > 0 ? Math.min(...caps) : matching.length;
          const page = matching.slice(0, limit);
          const nextQuery =
            page.length > 0 && matching.length > page.length ? { pageToken: page[page.length - 1] } : null;
          const files = page.map((objectName) => ({
            name: objectName,
            delete: (opts?: { ignoreNotFound?: boolean }) => {
              const attempt = store.fileDeleteAttempts.filter((n) => n === objectName).length;
              store.fileDeleteAttempts.push(objectName);
              inFlight += 1;
              store.maxConcurrentFileDeletes = Math.max(store.maxConcurrentFileDeletes, inFlight);
              const settle = <T>(value: T): T => {
                inFlight -= 1;
                return value;
              };
              const injected = store.failFileDelete?.(objectName, attempt) ?? null;
              if (injected !== null) return Promise.resolve().then(() => Promise.reject(settle(injected)));
              store.events.push(`storageDelete:${objectName}`);
              store.fileDeletes.push({ name: objectName, ignoreNotFound: opts?.ignoreNotFound === true });
              store.objects.delete(objectName);
              return Promise.resolve().then(() => settle(undefined));
            },
          }));
          return Promise.resolve([files, nextQuery] as [FakeFile[], { pageToken: string } | null]);
        },
      };
    },
  };

  store.deps = {
    db: store.db as unknown as Firestore,
    storage: store.storage as unknown as Storage,
    bucketName: FAKE_BUCKET,
  };

  return store;
}

/** Build `count` docs with zero-padded ids, so id order is also insertion order. */
export function seedDocs(count: number, data: (index: number) => DocData): Record<string, DocData> {
  const out: Record<string, DocData> = {};
  for (let i = 0; i < count; i++) out[`d${String(i).padStart(5, "0")}`] = data(i);
  return out;
}

/** Position of the first event matching `needle`, or -1. Used for ordering assertions. */
export function eventIndex(store: FakeStore, needle: string): number {
  return store.events.indexOf(needle);
}
