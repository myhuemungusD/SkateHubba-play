/**
 * Push dispatch courier, Cloud Functions edition.
 *
 * Same contract as api/cron/drain-push-dispatch.ts (manual-only Vercel
 * endpoint, workflow_dispatch): validate the doc, drop it after a 24h TTL,
 * send through FCM, prune tokens FCM calls dead (and their platform tags),
 * re-check Roll Dice pushes against platform tags, delete only after FCM
 * accepts. Moved here (approved by the repo owner, 2026-10-17) so pushes go
 * out the moment a /push_dispatch doc is created instead of waiting for a
 * cron tick, and so delivery no longer depends on the GitHub Actions budget.
 * Both couriers must stay in lockstep on the dice filter and the tag prune.
 *
 * Deps are injected so the logic is unit-tested without firebase-admin.
 *
 * Roll Dice pushes are re-checked here against the recipient's token platform
 * tags (see platforms.ts), so a dice push queued before the tags existed, or
 * by any future writer, still never reaches an iPhone while dice is off there.
 */
import { diceEligibleTokens, isDicePush, mirrorTokens } from "./platforms.js";
import { webpushOptions, type WebpushOptions } from "./webpush.js";

/** Drop undelivered pushes older than this. Matches the endpoint's TTL. */
export const PUSH_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Docs created before this instant are dropped unsent. pushDispatchOnCreate and
 * pushDispatchSweep were never deployed between #721 (2026-10-17) and
 * 2026-10-21 (run 39634702670 silently skipped them), so /push_dispatch holds
 * a backlog. Sending it hours late would ping people about turns that already
 * moved on. Anything queued after the go-live deploy is newer than this, so
 * the cutoff is a no-op from then on.
 */
export const PUSH_BACKLOG_CUTOFF_MS = Date.parse("2026-10-22T04:00:00Z");

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
  /**
   * Tokens named on the doc (server writers and older clients), or null when
   * the doc names none: the courier then resolves them from pushTargets (M1).
   */
  tokens: string[] | null;
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
    webpush: WebpushOptions;
  }) => Promise<MulticastResult>;
  /** Remove dead tokens from pushTargets + private profile. */
  prune: (recipientUid: string, dead: string[]) => Promise<void>;
  /** The recipient's pushTargets doc, for token lookup and the dice check. Undefined when missing. */
  pushTarget: (recipientUid: string) => Promise<Record<string, unknown> | undefined>;
  warn: (event: string, fields: Record<string, unknown>) => void;
  nowMs: number;
}

export interface QueuedDoc {
  id: string;
  data: Record<string, unknown> | undefined;
  delete: () => Promise<unknown>;
}

/** "filtered": dropped without sending: the recipient has no registered device, or a dice push whose tokens are all iOS or untagged. */
export type DocOutcome = "sent" | "expired" | "malformed" | "filtered" | "error";

export interface DrainSummary {
  scanned: number;
  sent: number;
  expired: number;
  malformed: number;
  filtered: number;
  errors: number;
  skippedFresh: number;
}

/** Validate a dispatch doc. Null means malformed and deletable. */
export function parseDispatchDoc(raw: Record<string, unknown> | undefined): DispatchPayload | null {
  if (!raw) return null;
  // No `tokens` key: resolve from the recipient's pushTargets doc at send
  // time (M1). A present-but-bad list is still malformed.
  const tokensRaw = raw.tokens;
  let tokens: string[] | null = null;
  if (tokensRaw !== undefined) {
    if (!Array.isArray(tokensRaw)) return null;
    tokens = tokensRaw.filter((t): t is string => typeof t === "string" && t.length > 0);
    if (tokens.length === 0) return null;
  }

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
    if (
      payload.createdAtMs !== null &&
      (deps.nowMs - payload.createdAtMs > PUSH_TTL_MS || payload.createdAtMs < PUSH_BACKLOG_CUTOFF_MS)
    ) {
      await doc.delete();
      return "expired";
    }

    // One mirror read serves both the token lookup (doc names none) and the
    // dice platform check.
    const needsMirror = payload.tokens === null || isDicePush(payload.data);
    const mirror = needsMirror ? await deps.pushTarget(payload.recipientUid) : undefined;
    let tokens = payload.tokens ?? mirrorTokens(mirror);
    if (isDicePush(payload.data)) tokens = diceEligibleTokens(mirror, tokens);
    if (tokens.length === 0) {
      // No registered device, or none allowed for dice: nothing to send.
      await doc.delete();
      return "filtered";
    }

    const response = await deps.send({
      tokens,
      notification: { title: payload.title, body: payload.body },
      data: payload.data,
      // Tap link, icon and per-game tag for web tokens (see webpush.ts).
      webpush: webpushOptions(payload.data),
    });

    const dead: string[] = [];
    response.responses.forEach((r, i) => {
      if (!r.success && r.error && DEAD_TOKEN_CODES.has(r.error.code)) dead.push(tokens[i]);
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
  const summary: DrainSummary = {
    scanned: 0,
    sent: 0,
    expired: 0,
    malformed: 0,
    filtered: 0,
    errors: 0,
    skippedFresh: 0,
  };
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
    else if (outcome === "filtered") summary.filtered += 1;
    else summary.errors += 1;
  }
  return summary;
}
