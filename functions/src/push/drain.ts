/**
 * Push dispatch courier, Cloud Functions edition.
 *
 * Same contract as api/cron/drain-push-dispatch.ts (the Vercel endpoint the
 * GitHub Actions cron used to call): validate the doc, drop it after a 24h TTL,
 * send through FCM, prune tokens FCM calls dead, delete only after FCM accepts.
 * Moved here (approved by the repo owner, 2026-10-17) so pushes go out the
 * moment a /push_dispatch doc is created instead of waiting for a cron tick,
 * and so delivery no longer depends on the GitHub Actions budget.
 *
 * Deps are injected so the logic is unit-tested without firebase-admin.
 */

/** Drop undelivered pushes older than this. Matches the endpoint's TTL. */
export const PUSH_TTL_MS = 24 * 60 * 60 * 1000;

/** The scheduled retry pass leaves docs younger than this to the create trigger. */
export const RETRY_MIN_AGE_MS = 2 * 60 * 1000;

/** Max docs per scheduled retry pass. */
export const MAX_PER_RUN = 200;

export const PUSH_DISPATCH_COLLECTION = "push_dispatch";

const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/invalid-argument",
]);

export interface DispatchPayload {
  tokens: string[];
  title: string;
  body: string;
  data: Record<string, string>;
  recipientUid: string;
  createdAtMs: number | null;
}

export interface MulticastResult {
  failureCount: number;
  responses: { success: boolean; error?: { code: string } }[];
}

export interface DrainDeps {
  send: (msg: {
    tokens: string[];
    notification: { title: string; body: string };
    data: Record<string, string>;
  }) => Promise<MulticastResult>;
  /** Remove dead tokens from pushTargets + private profile. */
  prune: (recipientUid: string, dead: string[]) => Promise<void>;
  warn: (event: string, fields: Record<string, unknown>) => void;
  nowMs: number;
}

export interface QueuedDoc {
  id: string;
  data: Record<string, unknown> | undefined;
  delete: () => Promise<unknown>;
}

export type DocOutcome = "sent" | "expired" | "malformed" | "error";

export interface DrainSummary {
  scanned: number;
  sent: number;
  expired: number;
  malformed: number;
  errors: number;
  skippedFresh: number;
}

/** Validate a dispatch doc. Null means malformed and deletable. */
export function parseDispatchDoc(raw: Record<string, unknown> | undefined): DispatchPayload | null {
  if (!raw) return null;
  const tokensRaw = raw.tokens;
  if (!Array.isArray(tokensRaw)) return null;
  const tokens = tokensRaw.filter((t): t is string => typeof t === "string" && t.length > 0);
  if (tokens.length === 0) return null;

  const notification = raw.notification;
  if (typeof notification !== "object" || notification === null) return null;
  const { title, body } = notification as { title?: unknown; body?: unknown };
  if (typeof title !== "string" || typeof body !== "string") return null;

  const recipientUid = raw.recipientUid;
  if (typeof recipientUid !== "string" || recipientUid.length === 0) return null;

  // FCM needs string data values; drop anything else instead of wedging the doc.
  const data: Record<string, string> = {};
  const dataRaw = raw.data;
  if (typeof dataRaw === "object" && dataRaw !== null) {
    for (const [k, v] of Object.entries(dataRaw as Record<string, unknown>)) {
      if (typeof v === "string") data[k] = v;
    }
  }

  const createdAt = raw.createdAt;
  const createdAtMs =
    typeof createdAt === "object" &&
    createdAt !== null &&
    typeof (createdAt as { toMillis?: unknown }).toMillis === "function"
      ? (createdAt as { toMillis: () => number }).toMillis()
      : null;

  return { tokens, title, body, data, recipientUid, createdAtMs };
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Deliver one dispatch doc. Never throws: a transient failure leaves the doc in
 * place (outcome "error") for the scheduled retry pass. At-least-once: the doc
 * is deleted only after FCM accepted the send.
 */
export async function deliverDispatch(doc: QueuedDoc, deps: DrainDeps): Promise<DocOutcome> {
  try {
    const payload = parseDispatchDoc(doc.data);
    if (!payload) {
      await doc.delete();
      return "malformed";
    }
    if (payload.createdAtMs !== null && deps.nowMs - payload.createdAtMs > PUSH_TTL_MS) {
      await doc.delete();
      return "expired";
    }

    const response = await deps.send({
      tokens: payload.tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
    });

    const dead: string[] = [];
    response.responses.forEach((r, i) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) dead.push(payload.tokens[i]);
    });
    if (dead.length > 0) {
      try {
        await deps.prune(payload.recipientUid, dead);
      } catch (err) {
        // Best-effort; a stale token is re-pruned on the next send.
        deps.warn("drain_prune_failed", { recipientUid: payload.recipientUid, message: message(err) });
      }
    }

    await doc.delete();
    return "sent";
  } catch (err) {
    deps.warn("drain_dispatch_failed", { dispatchId: doc.id, message: message(err) });
    return "error";
  }
}

/**
 * Scheduled retry pass over the oldest queued docs. Docs younger than
 * RETRY_MIN_AGE_MS are skipped so this pass never races the create trigger
 * on a doc it is still sending (which would double-send).
 */
export async function drainQueue(
  docs: (QueuedDoc & { createdAtMs: number | null })[],
  deps: DrainDeps,
): Promise<DrainSummary> {
  const summary: DrainSummary = { scanned: 0, sent: 0, expired: 0, malformed: 0, errors: 0, skippedFresh: 0 };
  for (const doc of docs) {
    summary.scanned += 1;
    if (doc.createdAtMs !== null && deps.nowMs - doc.createdAtMs < RETRY_MIN_AGE_MS) {
      summary.skippedFresh += 1;
      continue;
    }
    const outcome = await deliverDispatch(doc, deps);
    if (outcome === "sent") summary.sent += 1;
    else if (outcome === "expired") summary.expired += 1;
    else if (outcome === "malformed") summary.malformed += 1;
    else summary.errors += 1;
  }
  return summary;
}
