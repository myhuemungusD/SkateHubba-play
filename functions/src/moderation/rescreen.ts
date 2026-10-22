/**
 * Admin rescreen of clips stuck at moderation == "pending".
 *
 * `moderateNewClip` only fires on create. A clip written while the server
 * switch (MODERATION_ENABLED) was off is left pending and never screened.
 * This module finds those clips and runs each one through the same
 * `handleClipCreated` path the trigger uses. It is driven by
 * scripts/moderation/rescreen-pending.mjs, normally from the
 * moderation-rescreen.yml workflow (Workload Identity Federation, no key file).
 * Nothing here is exported from index.ts, so it never deploys as a function
 * and never reaches the client.
 *
 * Safety:
 *  - Dry run unless `apply` is set. A dry run only reads.
 *  - Each clip is re-read right before it is screened and skipped unless it
 *    is still a pending user upload. The handler's own transaction then
 *    re-checks "pending" at write time, so a decision made by the live
 *    trigger or an admin in between is never overwritten.
 *  - Clips younger than `minAgeMs` are left to the live trigger.
 *  - `maxErrors` screener failures in a row stop the run, so a missing IAM
 *    role or quota sends at most that many clips to review.
 */
import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";
import { handleClipCreated } from "./handlers.js";
import { adminClipStore } from "./publish.js";
import type { UploadOutcome } from "./runUpload.js";

export interface PendingClip {
  id: string;
  data: Record<string, unknown>;
}

export interface RescreenDeps {
  /** Every clip with moderation == "pending" or moderationStatus == "pending". */
  listPending: () => Promise<PendingClip[]>;
  /** Fresh read of one clip, or null if it was deleted. */
  read: (clipId: string) => Promise<Record<string, unknown> | null>;
  /** The owner's username, or "" when it cannot be found. */
  ownerHandle: (clip: Record<string, unknown>) => Promise<string>;
  /** The shared upload screener (handleClipCreated with admin options). */
  screen: (clipId: string, clip: Record<string, unknown>) => Promise<UploadOutcome>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

export interface RescreenOptions {
  apply: boolean;
  /** Most clips to screen (or list) this run. */
  limit: number;
  /** Pause between screened clips, to spread Video Intelligence calls. */
  delayMs: number;
  /** Skip clips newer than this; the live trigger may still be on them. */
  minAgeMs: number;
  /** Stop after this many screener errors in a row. */
  maxErrors: number;
}

export type RescreenAction =
  | "would-screen"
  | "screened"
  | "skipped-changed"
  | "skipped-deleted"
  | "skipped-too-new"
  | "skipped-not-screenable"
  | "error"
  | "not-run-limit"
  | "not-run-stopped";

export interface RescreenRow {
  clipId: string;
  owner: string;
  ageMs: number | null;
  before: string;
  after: string;
  action: RescreenAction;
  note: string;
}

export interface RescreenResult {
  rows: RescreenRow[];
  stopped: boolean;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function millisOf(value: unknown): number | null {
  const ts = value as { toMillis?: () => number } | null | undefined;
  if (ts && typeof ts.toMillis === "function") {
    const ms = ts.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** "moderation/moderationStatus", e.g. "pending/pending". Missing fields read "-". */
export function stateOf(clip: Record<string, unknown> | null): string {
  if (!clip) return "deleted";
  const field = (v: unknown): string => (typeof v === "string" && v.length > 0 ? v : "-");
  return `${field(clip.moderation)}/${field(clip.moderationStatus)}`;
}

/** The same precondition the handler applies: a user upload still pending. */
export function isScreenable(clip: Record<string, unknown> | null): boolean {
  return !!clip && clip.source === "user" && clip.moderation === "pending";
}

/** Short screener error text left in moderationScores.error, if any. */
function screenerError(clip: Record<string, unknown> | null): string {
  const error = asRecord(clip?.moderationScores).error;
  return typeof error === "string" ? error : "";
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 200);
}

function storedHandle(clip: Record<string, unknown>): string {
  return typeof clip.playerUsername === "string" ? clip.playerUsername : "";
}

/** Oldest first; clips with no createdAt sort last. */
function byAge(a: PendingClip, b: PendingClip): number {
  const am = millisOf(a.data.createdAt) ?? Number.POSITIVE_INFINITY;
  const bm = millisOf(b.data.createdAt) ?? Number.POSITIVE_INFINITY;
  if (am !== bm) return am < bm ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function rescreenPending(deps: RescreenDeps, options: RescreenOptions): Promise<RescreenResult> {
  const clips = (await deps.listPending()).sort(byAge);
  const rows: RescreenRow[] = [];
  let used = 0;
  let errorsInRow = 0;
  let stopped = false;

  for (const listed of clips) {
    const createdMs = millisOf(listed.data.createdAt);
    const row: RescreenRow = {
      clipId: listed.id,
      // Free: the handle stored on the clip. users/{uid} is only read below,
      // for rows that count against --limit.
      owner: storedHandle(listed.data),
      ageMs: createdMs === null ? null : Math.max(0, deps.now() - createdMs),
      before: stateOf(listed.data),
      after: stateOf(listed.data),
      action: "would-screen",
      note: "",
    };
    rows.push(row);

    if (!isScreenable(listed.data)) {
      row.action = "skipped-not-screenable";
      row.note =
        listed.data.source !== "user"
          ? "not a user upload; the screener only handles user clips"
          : "moderation is not 'pending'; the screener only acts on moderation == 'pending'";
      continue;
    }
    if (row.ageMs !== null && row.ageMs < options.minAgeMs) {
      row.action = "skipped-too-new";
      row.note = "younger than --min-age; left to the live trigger";
      continue;
    }
    if (stopped) {
      row.action = "not-run-stopped";
      continue;
    }
    if (used >= options.limit) {
      row.action = "not-run-limit";
      continue;
    }
    used += 1;
    row.owner = await deps.ownerHandle(listed.data);
    if (!options.apply) continue;

    if (used > 1 && options.delayMs > 0) await deps.sleep(options.delayMs);

    const fresh = await deps.read(listed.id);
    row.before = stateOf(fresh);
    if (!fresh) {
      row.action = "skipped-deleted";
      row.after = "deleted";
      continue;
    }
    if (!isScreenable(fresh)) {
      row.action = "skipped-changed";
      row.after = row.before;
      row.note = "changed since listing; left as is";
      continue;
    }

    let outcome: UploadOutcome;
    try {
      outcome = await deps.screen(listed.id, fresh);
    } catch (error) {
      row.action = "error";
      row.note = errorText(error);
      row.after = stateOf(await deps.read(listed.id).catch(() => fresh));
      errorsInRow += 1;
      if (errorsInRow >= options.maxErrors) stopped = true;
      continue;
    }
    const after = await deps.read(listed.id);
    row.after = stateOf(after);
    // The handler reports "review" for a failure even when its pending-only
    // write was refused, so trust the stored state, not just the outcome.
    if (outcome === "skipped" || after?.moderation !== outcome) {
      row.action = "skipped-changed";
      row.note = "a decision landed first; the handler's pending-only guard kept it";
      continue;
    }
    const failure = outcome === "review" ? screenerError(after) : "";
    if (failure.length > 0) {
      row.action = "error";
      row.note = `screener error, sent to review: ${failure.slice(0, 200)}`;
      errorsInRow += 1;
      if (errorsInRow >= options.maxErrors) stopped = true;
      continue;
    }
    row.action = "screened";
    row.note = `outcome ${outcome}`;
    errorsInRow = 0;
  }
  return { rows, stopped };
}

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return "unknown";
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
}

export interface RescreenLogMeta {
  startedAt: string;
  finishedAt: string;
  apply: boolean;
  project: string;
  database: string;
  options: RescreenOptions;
}

/** One markdown section per run. Ids, handles, ages and states only. */
export function renderRescreenLog(result: RescreenResult, meta: RescreenLogMeta): string {
  const counts = new Map<string, number>();
  for (const row of result.rows) counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
  const summary = [...counts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([action, n]) => `${action} ${n}`)
    .join(", ");
  const o = meta.options;
  const lines = [
    `## Rescreen ${meta.apply ? "APPLY" : "DRY RUN"}: ${meta.startedAt}`,
    "",
    `- Project ${cell(meta.project)}, database ${cell(meta.database)}. Finished ${meta.finishedAt}.`,
    `- limit ${o.limit}, delay ${o.delayMs} ms, min age ${Math.round(o.minAgeMs / 60_000)} min, max errors in a row ${o.maxErrors}.`,
    `- Listed ${result.rows.length}. ${summary.length > 0 ? summary : "Nothing pending"}.${result.stopped ? " **Stopped early after repeated screener errors.**" : ""}`,
    "- State is `moderation/moderationStatus`.",
    "",
  ];
  if (result.rows.length > 0) {
    lines.push("| Clip | Owner | Age | Before | After | Action | Note |", "|---|---|---|---|---|---|---|");
    for (const row of result.rows) {
      lines.push(
        `| ${cell(row.clipId)} | ${row.owner.length > 0 ? `@${cell(row.owner)}` : "(unknown)"} | ${formatAge(row.ageMs)} | ${cell(row.before)} | ${cell(row.after)} | ${row.action} | ${cell(row.note)} |`,
      );
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}

/** Firestore-backed deps. `screen` is supplied by the caller (handleClipCreated). */
export function firestoreRescreenDeps(db: Firestore, screen: RescreenDeps["screen"]): RescreenDeps {
  const clips = db.collection("clips");
  return {
    listPending: async () => {
      const [byModeration, byStatus] = await Promise.all([
        clips.where("moderation", "==", "pending").get(),
        clips.where("moderationStatus", "==", "pending").get(),
      ]);
      const seen = new Map<string, PendingClip>();
      for (const doc of [...byModeration.docs, ...byStatus.docs]) {
        if (!seen.has(doc.id)) seen.set(doc.id, { id: doc.id, data: doc.data() });
      }
      return [...seen.values()];
    },
    read: async (clipId) => {
      const snap = await clips.doc(clipId).get();
      return snap.exists ? (snap.data() ?? {}) : null;
    },
    ownerHandle: async (clip) => {
      if (typeof clip.playerUsername === "string" && clip.playerUsername.length > 0) return clip.playerUsername;
      const uid = typeof clip.playerUid === "string" ? clip.playerUid : "";
      if (uid.length === 0) return "";
      const user = await db.collection("users").doc(uid).get();
      const username = user.get("username");
      return typeof username === "string" ? username : "";
    },
    screen,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
  };
}

export interface AdminRuntimeOptions {
  databaseId: string;
  /** Project id to pin. Empty lets Application Default Credentials find it. */
  projectId: string;
  sentryDsn: string;
}

export interface AdminRuntime {
  projectId: string;
  deps: RescreenDeps;
  /** Mint one token up front so a bad credential fails before any clip is touched. */
  checkToken: () => Promise<void>;
}

/**
 * Admin SDK wiring for the script. `screen` is exactly the trigger's
 * handler with the trigger's options, except the switch is passed as on
 * (the script refuses to run otherwise) and the Video Intelligence token
 * comes from Application Default Credentials instead of the metadata server.
 */
export function adminRescreenRuntime(options: AdminRuntimeOptions): AdminRuntime {
  // Application Default Credentials only. In GitHub Actions,
  // google-github-actions/auth writes a Workload Identity Federation
  // (external_account) config and points GOOGLE_APPLICATION_CREDENTIALS at it;
  // google-auth-library exchanges the OIDC token for a short-lived token of
  // the deploy service account. cert() only accepts a service-account key, so
  // it would reject that file. There is deliberately no key-file path here.
  const credential = applicationDefault();
  const projectId = options.projectId;
  initializeApp(projectId.length > 0 ? { credential, projectId } : { credential });
  const db = getFirestore(options.databaseId);
  const getToken = async (): Promise<string> => (await credential.getAccessToken()).access_token;
  const screen: RescreenDeps["screen"] = (clipId, clip) =>
    handleClipCreated(
      { db, enabled: true, sentryDsn: options.sentryDsn, media: adminClipStore(), getToken },
      clipId,
      clip,
    );
  return {
    projectId,
    deps: firestoreRescreenDeps(db, screen),
    checkToken: async () => {
      const token = await getToken();
      if (token.length === 0) throw new Error("the credential returned an empty access token");
    },
  };
}
