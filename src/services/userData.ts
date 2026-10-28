import { Timestamp, getDocFromServer, getDocsFromServer, type DocumentReference, type Query } from "firebase/firestore";
import { requireDb } from "../firebase";
import { withRetry } from "../utils/retry";
import { logger } from "./logger";
import { captureMessage } from "../lib/sentry";
import { getErrorCode } from "../utils/helpers";
import {
  FIRESTORE_EXPORT,
  type ExportDocSection,
  type ExportListSection,
  type ExportPlan,
  type ExportSection,
} from "../../api/account/_userDataRegistry";
import {
  EXPORT_MAX_PAGES,
  EXPORT_PAGE_SIZE,
  exportNextPage,
  exportReadPlan,
  isIncluded,
  type PlannedRead,
} from "./userDataQueries";

/**
 * Schema version for the GDPR Article 20 data export bundle. Increment when
 * the shape of `UserDataExport` changes so consumers can detect an
 * incompatible dump.
 *
 * v2: added `complete`, `missingSections`, `truncatedSections` and `notice`,
 * so a file that is missing data says so instead of looking like the user
 * has none.
 * v3: sections come from the registry (api/account/_userDataRegistry.ts).
 * The v2 section keys are unchanged; new sections were added beside them,
 * plus `redactedFields`.
 */
export const USER_DATA_EXPORT_SCHEMA_VERSION = 3 as const;

/** Where to write if an export keeps coming back incomplete. */
export const PRIVACY_CONTACT_EMAIL = "privacy@skatehubba.com";

/** Most docs one list can hold in the file (pages × page size). */
export const EXPORT_MAX_DOCS_PER_LIST = EXPORT_MAX_PAGES * EXPORT_PAGE_SIZE;

/** Shown when no section at all could be read, so no file is made. */
export const EXPORT_FAILED_MESSAGE = "We couldn't load your data. Check your connection and try again.";

/**
 * Shape of a single Firestore doc included in the export. The payload is
 * whatever Firestore returned, post-normalisation: Timestamps become ISO
 * strings so the JSON round-trips cleanly.
 */
export interface ExportedDoc {
  id: string;
  path: string;
  data: Record<string, unknown>;
}

export type { ExportDocSection, ExportListSection, ExportSection } from "../../api/account/_userDataRegistry";

/**
 * Sections in file order (registry order), each with its plain-words name for
 * the file notice and the UI. Built from `FIRESTORE_EXPORT`, so a section
 * added to the registry is named here too.
 */
const SECTION_NAMES: ReadonlyMap<ExportSection, string> = new Map(
  (Object.values(FIRESTORE_EXPORT) as ExportPlan[])
    .filter(isIncluded)
    .map((p) => [p.section as ExportSection, p.name] as const),
);

/** Fixed order so the missing list reads the same way every time. */
const SECTION_ORDER: readonly ExportSection[] = [...SECTION_NAMES.keys()];

/** File metadata, around the data sections. */
export interface UserDataExportMeta {
  schemaVersion: typeof USER_DATA_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  /** False when a section could not be read or was too long to include in full. */
  complete: boolean;
  /** Sections that could not be read (in full) this time. */
  missingSections: ExportSection[];
  /** Lists longer than {@link EXPORT_MAX_DOCS_PER_LIST}; the file holds the first part. */
  truncatedSections: ExportSection[];
  /** Plain-words explanation, present only when the file is incomplete. */
  notice?: string;
  /** Same as `truncatedSections.length > 0`; kept for v1 readers. */
  capped: boolean;
  /**
   * Fields left out of the docs in a section: device tokens, and the uids of
   * staff who acted on the account. Same for every file; listed so a reader
   * knows they were withheld rather than never stored.
   */
  redactedFields: Partial<Record<ExportSection, string[]>>;
  subject: {
    uid: string;
    username: string;
  };
}

/**
 * Full GDPR Article 15/20 data bundle for one user.
 *
 * What goes in comes from one place: `FIRESTORE_EXPORT` in
 * api/account/_userDataRegistry.ts, keyed exactly like the erasure registry.
 * Every collection deletion knows about is either read here (as the signed-in
 * owner, through the same rules that guard normal reads) or listed there as
 * excluded with the reason. `user-data-export.coverage.test.ts` fails when a
 * collection is neither. The registry's `excluded` and `fix` strings are the
 * record of what is left out and what would close each gap.
 *
 * Each section is one doc (or `null` when there is none) when it comes from a
 * single doc read such as the profile, and a list otherwise. Video and image
 * files are linked by URL inside the docs, not embedded.
 *
 * Every read goes to the server (`getDocFromServer` / `getDocsFromServer`),
 * never the offline cache, so a file can't say "complete" while holding only
 * what happened to be cached. Lists are read page by page up to
 * {@link EXPORT_MAX_DOCS_PER_LIST} docs and sorted newest first by
 * `createdAt`.
 *
 * If a read fails, its section is named in `missingSections`. If a list is
 * longer than the ceiling, it is named in `truncatedSections`. Either way
 * `complete` is `false` and `notice` explains it in plain words. An empty
 * list in a complete file means "nothing stored", never "couldn't read it".
 */
export type UserDataExport = UserDataExportMeta & { [S in ExportDocSection]: ExportedDoc | null } & {
  [S in ExportListSection]: ExportedDoc[];
};

/**
 * What "Download my data" hands back to the screen: which sections the saved
 * file is missing, so the UI can say so.
 */
export interface DataDownloadOutcome {
  missingSections: ExportSection[];
  truncatedSections: ExportSection[];
}

/** "game history", "game history and clips", "a, b and c". */
export function describeMissingSections(sections: readonly ExportSection[]): string {
  // Several sections can share a plain name (the three cooldown lists).
  const names = [...new Set(sections.map((s) => SECTION_NAMES.get(s) as string))];
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * Plain-words explanation of an incomplete export, shared by the file's
 * `notice` and the on-screen warning. Empty when nothing is missing.
 */
export function describeIncompleteExport(
  missingSections: readonly ExportSection[],
  truncatedSections: readonly ExportSection[],
): string {
  const parts: string[] = [];
  if (missingSections.length > 0) {
    parts.push(
      `We couldn't load all of your ${describeMissingSections(missingSections)} this time, ` +
        "so that part of the file may be empty or incomplete. Try again in a few minutes.",
    );
  }
  if (truncatedSections.length > 0) {
    const max = EXPORT_MAX_DOCS_PER_LIST.toLocaleString("en-US");
    const many = truncatedSections.length > 1;
    parts.push(
      `You have more than ${max} items in ${many ? "each of " : ""}your ` +
        `${describeMissingSections(truncatedSections)}, so the file holds the first ${max}${many ? " of each" : ""}.`,
    );
  }
  if (parts.length === 0) return "";
  parts.push(`If you need a complete copy, email ${PRIVACY_CONTACT_EMAIL}.`);
  return parts.join(" ");
}

/** Thrown when no section at all could be read: there is no file worth saving. */
export class UserDataExportError extends Error {
  /** Firestore error code per failed read, for Sentry. No personal data. */
  readonly codes: Record<string, string>;
  constructor(codes: Record<string, string>) {
    super(EXPORT_FAILED_MESSAGE);
    this.name = "UserDataExportError";
    this.codes = codes;
  }
}

/**
 * Recursively replace Firestore Timestamps with ISO strings so the export
 * round-trips through JSON.stringify cleanly. Firestore's Timestamp class
 * serialises as `{seconds, nanoseconds}` which is valid JSON but opaque to
 * humans reading the dump.
 */
function normalizeTimestamps(value: unknown): unknown {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(normalizeTimestamps);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeTimestamps(v);
    }
    return out;
  }
  return value;
}

function toExportedDoc(id: string, path: string, data: unknown, redact: readonly string[] = []): ExportedDoc {
  const normalized = normalizeTimestamps(data);
  // Firestore's data() always returns an object when exists() is true, but
  // tests may pass anything through — coerce non-objects to {} so the
  // ExportedDoc shape is predictable.
  const asObject =
    normalized && typeof normalized === "object" && !Array.isArray(normalized)
      ? (normalized as Record<string, unknown>)
      : {};
  for (const field of redact) delete asObject[field];
  return { id, path, data: asObject };
}

/** Millisecond sort key for a doc's `createdAt` (ISO string after normalising). */
function createdAtMillis(d: ExportedDoc): number {
  const v = d.data.createdAt;
  const ms = typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/**
 * Newest first by `createdAt`, done here because the queries can't `orderBy`
 * without composite indexes (see userDataQueries.ts). Docs without a usable
 * `createdAt` go last; ties keep query order.
 */
function sortNewestFirst(docs: ExportedDoc[]): ExportedDoc[] {
  return [...docs].sort((x, y) => {
    const a = createdAtMillis(x);
    const b = createdAtMillis(y);
    if (a === b) return 0;
    return a > b ? -1 : 1;
  });
}

/**
 * Merge lists that can return the same doc (a game the user both played and
 * judged), keeping the first copy. Keyed by path: collection-group reads can
 * return two docs with the same id under different parents.
 */
function dedupe(lists: ExportedDoc[][]): ExportedDoc[] {
  const seen = new Set<string>();
  const out: ExportedDoc[] = [];
  for (const d of lists.flat()) {
    if (!seen.has(d.path)) {
      seen.add(d.path);
      out.push(d);
    }
  }
  return out;
}

/** One read's result. A failed read keeps what it got and its error code. */
type Read<T> =
  | {
      value: T;
      ok: true;
      /** True when a list hit {@link EXPORT_MAX_PAGES} with more still to read. */
      truncated?: boolean;
    }
  | { value: T; ok: false; code: string };

/** One planned read, run. */
type RanRead = { plan: PlannedRead; result: Read<ExportedDoc | null> | Read<ExportedDoc[]> };

/**
 * Collect every piece of personal data we hold about `uid`/`username` into a
 * single bundle suitable for GDPR Article 20 / CCPA data-portability
 * requests. The reads come from {@link exportReadPlan}, which is built from
 * the registry.
 *
 * Each read runs independently: if one fails the others still land, and the
 * failed section is named in `missingSections` (with a plain `notice`)
 * rather than silently exported as empty. The user can retry to fill it in.
 * If every read fails, this throws {@link UserDataExportError} instead of
 * producing a near-empty file.
 *
 * Firestore security rules still apply; this function must be called while
 * authenticated AS `uid` so the same rules that protect normal reads also
 * protect the export.
 */
export async function exportUserData(uid: string, username: string): Promise<UserDataExport> {
  if (!uid) throw new Error("exportUserData requires a uid");
  const normalizedUsername = username.toLowerCase().trim();
  const db = requireDb();
  const plan = exportReadPlan(db, uid, normalizedUsername);

  const ran: RanRead[] = await Promise.all(plan.map(async (p) => ({ plan: p, result: await run(p) })));

  // Reads with nothing to do (no username to look up) count as ok, not failed.
  const attempted = ran.filter((r) => r.plan.step !== null);
  const codes: Record<string, string> = {};
  for (const { plan: p, result } of attempted) if (!result.ok) codes[p.label] = result.code;

  // Nothing could be read at all (offline, signed out): no file is better
  // than a near-empty one with every section flagged.
  if (attempted.every((r) => !r.result.ok)) {
    throw new UserDataExportError(codes);
  }

  // A section is missing if any read that feeds it failed, and truncated if
  // any list that feeds it hit the page ceiling.
  const bySection = new Map<ExportSection, RanRead[]>();
  for (const r of ran) bySection.set(r.plan.section, [...(bySection.get(r.plan.section) ?? []), r]);
  const missingSections = SECTION_ORDER.filter((s) => bySection.get(s)?.some((r) => !r.result.ok));
  const truncatedSections = SECTION_ORDER.filter((s) =>
    bySection.get(s)?.some((r) => r.result.ok && r.result.truncated),
  );

  const sections = {} as Record<ExportSection, ExportedDoc | ExportedDoc[] | null>;
  const redactedFields: Partial<Record<ExportSection, string[]>> = {};
  for (const section of SECTION_ORDER) {
    const reads = bySection.get(section) as RanRead[];
    const single = reads.length === 1 && reads[0].plan.step?.type === "doc";
    const usernameRead = reads.length === 1 && reads[0].plan.step === null;
    if (single || usernameRead) {
      sections[section] = (reads[0].result.value as ExportedDoc | null) ?? null;
    } else {
      sections[section] = sortNewestFirst(dedupe(reads.map((r) => r.result.value as ExportedDoc[])));
    }
    const redact = [...new Set(reads.flatMap((r) => r.plan.redact))];
    if (redact.length > 0) redactedFields[section] = redact;
  }

  const complete = missingSections.length === 0 && truncatedSections.length === 0;
  if (!complete) {
    // Ops signal for partial exports. Section names and error codes only.
    captureMessage("user_data_export_partial", {
      level: "warning",
      extra: { missingSections, truncatedSections, codes },
    });
  }
  return {
    schemaVersion: USER_DATA_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    complete,
    missingSections,
    truncatedSections,
    ...(complete
      ? {}
      : {
          notice: `Some of your data is missing from this file. ${describeIncompleteExport(missingSections, truncatedSections)}`,
        }),
    capped: truncatedSections.length > 0,
    redactedFields,
    subject: { uid, username: normalizedUsername },
    ...(sections as Pick<UserDataExport, ExportSection>),
  };
}

function run(p: PlannedRead): Promise<Read<ExportedDoc | null> | Read<ExportedDoc[]>> {
  const step = p.step;
  if (step === null) return Promise.resolve({ value: null, ok: true });
  switch (step.type) {
    case "doc":
      return readDoc(p.label, step.ref, p.redact);
    case "query":
      return readCollection(p.label, step.first, p.redact);
    case "eachParent":
      return readUnderEachParent(p.label, step.parents, step.child, p.redact);
  }
}

/** Error code for logs and Sentry; never the message, which can carry a path. */
function codeOf(err: unknown): string {
  return getErrorCode(err) || "unknown";
}

async function readDoc(
  label: string,
  ref: DocumentReference,
  redact: readonly string[],
): Promise<Read<ExportedDoc | null>> {
  try {
    const snap = await withRetry(() => getDocFromServer(ref));
    if (!snap.exists()) return { value: null, ok: true };
    return { value: toExportedDoc(snap.id, ref.path, snap.data(), redact), ok: true };
  } catch (err) {
    const code = codeOf(err);
    logger.warn("user_data_export_doc_failed", { section: label, code });
    return { value: null, ok: false, code };
  }
}

/**
 * Read every page of one export query from the server. Stops when a page
 * comes back short, or at {@link EXPORT_MAX_PAGES} (then `truncated`). If a
 * page fails, the docs read so far are kept and the read is marked failed.
 */
async function readCollection(label: string, first: Query, redact: readonly string[]): Promise<Read<ExportedDoc[]>> {
  const docs: ExportedDoc[] = [];
  let page = first;
  try {
    for (let n = 1; ; n++) {
      const snap = await withRetry(() => getDocsFromServer(page));
      for (const d of snap.docs) docs.push(toExportedDoc(d.id, d.ref.path, d.data(), redact));
      if (snap.docs.length < EXPORT_PAGE_SIZE) return { value: docs, ok: true };
      if (n >= EXPORT_MAX_PAGES) {
        logger.warn("user_data_export_list_truncated", { section: label, pages: n });
        return { value: docs, ok: true, truncated: true };
      }
      page = exportNextPage(first, snap.docs[snap.docs.length - 1]);
    }
  } catch (err) {
    const code = codeOf(err);
    logger.warn("user_data_export_collection_failed", { section: label, code });
    return { value: docs, ok: false, code };
  }
}

/**
 * The user's doc under each parent (e.g. `drops/{id}/claims/{uid}`): lists
 * the parents within the same page ceiling, then gets each child. A failed
 * get keeps the rest and marks the read failed; a parent list cut off at the
 * ceiling marks it truncated.
 */
async function readUnderEachParent(
  label: string,
  parents: Query,
  child: (parentId: string) => DocumentReference,
  redact: readonly string[],
): Promise<Read<ExportedDoc[]>> {
  const listed = await readCollection(`${label}:parents`, parents, []);
  const got = await Promise.all(listed.value.map((p) => readDoc(label, child(p.id), redact)));
  const value = got.flatMap((r) => (r.value ? [r.value] : []));
  const failed = !listed.ok ? listed : got.find((r) => !r.ok);
  if (failed && !failed.ok) return { value, ok: false, code: failed.code };
  return { value, ok: true, ...(listed.ok && listed.truncated ? { truncated: true } : {}) };
}

/** Pretty-printed JSON serialisation of the export bundle. */
export function serializeUserData(bundle: UserDataExport): string {
  return JSON.stringify(bundle, null, 2);
}

/**
 * Build the filename used when the user saves the export locally. Includes
 * the username and ISO date so multiple exports don't clobber each other.
 */
export function userDataFilename(bundle: UserDataExport): string {
  const safeUsername = bundle.subject.username.replace(/[^a-z0-9_-]/gi, "") || "user";
  const date = bundle.exportedAt.slice(0, 10); // YYYY-MM-DD
  return `skatehubba-data-${safeUsername}-${date}.json`;
}
