import {
  collection,
  collectionGroup,
  doc,
  limit,
  query,
  startAfter,
  where,
  type DocumentReference,
  type DocumentSnapshot,
  type Firestore,
  type Query,
  type QueryConstraint,
} from "firebase/firestore";
import {
  FIRESTORE_EXPORT,
  type ExportIncluded,
  type ExportPlan,
  type ExportRead,
  type ExportSection,
} from "../../api/account/_userDataRegistry";

/**
 * Docs per page for each collection read. Reads page through with
 * `startAfter` until a page comes back short. This is the only place the
 * page size is set: the queries below use it and readCollection's "short
 * page means done" check uses it, so the two can't disagree.
 */
export const EXPORT_PAGE_SIZE = 500;

/**
 * Safety ceiling on pages per query (10 × 500 = 5,000 docs per list). A list
 * that still has a full page at the ceiling is reported as incomplete in the
 * export instead of being cut off silently.
 */
export const EXPORT_MAX_PAGES = 10;

/** How one planned read reaches Firestore. */
export type ExportStep =
  | { type: "doc"; ref: DocumentReference }
  | { type: "query"; first: Query }
  /** List every parent doc, then get `child(parentId)` under each. */
  | { type: "eachParent"; parents: Query; child: (parentId: string) => DocumentReference };

export interface PlannedRead {
  /**
   * Fixed string for logs and Sentry, built from the registry key and field
   * (e.g. "games.player1Uid", "users/{}/wallet", or "group:comments.userId"
   * for a collection-group read). Never a uid, username or real path.
   */
  label: string;
  section: ExportSection;
  redact: readonly string[];
  /** Null when there is nothing to read (no username to look up). */
  step: ExportStep | null;
}

export function isIncluded(plan: ExportPlan): plan is ExportIncluded {
  return "section" in plan;
}

// Path shapes (ownDoc/ownList keys are `users/{}/<sub>`, uidDoc/where keys
// are top-level, group/underEachParent keys are `<parent>/{}/<sub>`) are
// enforced by user-data-export.coverage.test.ts, not at runtime.

/** `users/{}/wallet` with the uid in place of `{}`, as path segments. */
function ownPath(key: string, uid: string): [string, string, string] {
  return ["users", uid, key.split("/")[2]];
}

function labelFor(key: string, read: ExportRead, many: boolean): string {
  // Both comment collections are one collection group: same label, read once.
  if (read.kind === "group") return `group:${key.split("/").pop()}.${read.field}`;
  // A plan with several reads tells them apart by field (the coverage test
  // requires one on each).
  return many ? `${key}.${(read as { field: string }).field}` : key;
}

function stepFor(db: Firestore, key: string, read: ExportRead, uid: string, username: string): ExportStep | null {
  const page = limit(EXPORT_PAGE_SIZE);
  switch (read.kind) {
    case "uidDoc":
      return { type: "doc", ref: doc(db, key, uid) };
    case "ownDoc":
      return { type: "doc", ref: doc(db, ...ownPath(key, uid), read.id) };
    case "ownList":
      return { type: "query", first: query(collection(db, ...ownPath(key, uid)), page) };
    case "usernameDoc":
      return username ? { type: "doc", ref: doc(db, key, username) } : null;
    case "where": {
      const filters: QueryConstraint[] = [where(read.field, "==", uid)];
      for (const [field, value] of Object.entries(read.also ?? {})) filters.push(where(field, "==", value));
      return { type: "query", first: query(collection(db, key), ...filters, page) };
    }
    case "arrayContains":
      return {
        type: "query",
        first: query(collection(db, key), where(read.field, "array-contains", uid), page),
      };
    case "group": {
      const group = key.split("/").pop() as string;
      return { type: "query", first: query(collectionGroup(db, group), where(read.field, "==", uid), page) };
    }
    case "underEachParent": {
      const [parent, , sub] = key.split("/");
      return {
        type: "eachParent",
        parents: query(collection(db, parent), page),
        child: (parentId) => doc(db, parent, parentId, sub, uid),
      };
    }
  }
}

/**
 * Every read behind "Download my data", built from `FIRESTORE_EXPORT` in
 * api/account/_userDataRegistry.ts, the single list of where user data
 * lives. Nothing here names a collection: adding one to the registry adds it
 * to the export.
 *
 * Kept free of app wiring (no `requireDb`, no logger) so the rules tests can
 * run these exact reads against the emulator as the signed-in owner.
 *
 * Two constraints every read here keeps:
 *
 *   1. Equality filters only (`==`, `array-contains`), no `orderBy`.
 *      Firestore serves those from its automatic single-field indexes (and,
 *      for the collection-group reads, the COLLECTION_GROUP field overrides
 *      in firestore.indexes.json). An `orderBy` on another field would need a
 *      composite index. Ordering is done in memory (`sortNewestFirst` in
 *      userData.ts); paging with `startAfter` uses the implicit document-id
 *      order, which needs no extra index.
 *
 *   2. Rules are not filters. Each read carries the constraint its read rule
 *      checks, or the whole query is refused (e.g. spots and privateSpots add
 *      `isActive == true`). rules-tests/user-data-export.rules.test.ts runs
 *      every read here as the owner against the emulator.
 */
export function exportReadPlan(db: Firestore, uid: string, username: string): PlannedRead[] {
  const out: PlannedRead[] = [];
  const seen = new Set<string>();
  for (const [key, plan] of Object.entries(FIRESTORE_EXPORT) as [string, ExportPlan][]) {
    if (!isIncluded(plan)) continue;
    for (const read of plan.reads) {
      const label = labelFor(key, read, plan.reads.length > 1);
      if (seen.has(label)) continue;
      seen.add(label);
      out.push({
        label,
        section: plan.section as ExportSection,
        redact: plan.redact ?? [],
        step: stepFor(db, key, read, uid, username),
      });
    }
  }
  return out;
}

/** The page after `last`, with the same filters and page size as `first`. */
export function exportNextPage(first: Query, last: DocumentSnapshot): Query {
  return query(first, startAfter(last));
}
