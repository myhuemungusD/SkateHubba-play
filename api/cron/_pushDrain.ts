/**
 * Dispatch-doc parsing and dead-token pruning for the push drain cron.
 *
 * Intentional mirror of `functions/src/push/drain.ts` (`parseDispatchDoc`) and
 * `functions/src/push/store.ts` (`pruneDeadTokens`): Vercel must not import the
 * functions package, so the two copies are kept in step by hand and are the
 * only api↔functions pair allowlisted in `.jscpd.json` besides `_pushPlatforms`
 * and `_pushWebpush`. Change both sides together.
 */
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { captureServerError } from "../_sentry.js";
import { safeErrorCode } from "../_safeError.js";

/** Collection — mirrors the constant in src/services/pushDispatch.ts. */
export const PUSH_TARGETS_COLLECTION = "pushTargets";

/** Owner-only canonical token list — mirrors PRIVATE_PROFILE_DOC_ID in users.ts. */
const PRIVATE_PROFILE_DOC_ID = "profile";

/**
 * The subset of a /push_dispatch doc this handler needs, after validation.
 * `buildDispatchDoc` in src/services/pushDispatch.ts is the authoring contract;
 * the sweep cron's `buildAdminDispatchDoc` writes the same shape.
 */
export interface DispatchPayload {
  /** Tokens named on the doc, or null: resolve them from pushTargets at send time (M1). */
  tokens: string[] | null;
  title: string;
  body: string;
  data: Record<string, string>;
  recipientUid: string;
  createdAtMs: number | null;
}

/**
 * Validate a dispatch doc against the authoring contract.
 *
 * Returns null for anything that does not match, which the caller treats as
 * malformed-and-deletable. We validate rather than trust because /push_dispatch
 * is client-writable: firestore.rules constrains the shape hard, but a doc
 * written before a rules tighten (or by a future writer) must never be able to
 * crash the drain or push an unbounded payload to a user's device.
 */
export function parseDispatchDoc(raw: Record<string, unknown>): DispatchPayload | null {
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

  // FCM requires every `data` value to be a string. The authoring path only
  // writes strings, but a non-string here would make the whole send throw and
  // wedge the doc in the queue forever — drop the offending key instead.
  const data: Record<string, string> = {};
  const dataRaw = raw.data;
  if (typeof dataRaw === "object" && dataRaw !== null) {
    for (const [k, v] of Object.entries(dataRaw as Record<string, unknown>)) {
      if (typeof v === "string") data[k] = v;
    }
  }

  // createdAt is a server Timestamp on every legitimate doc. A doc whose
  // timestamp has not resolved yet (or is absent) gets a null age and is
  // treated as "too new to expire" rather than being dropped.
  const createdAt = raw.createdAt;
  const createdAtMs =
    typeof createdAt === "object" &&
    createdAt !== null &&
    typeof (createdAt as { toMillis?: unknown }).toMillis === "function"
      ? (createdAt as { toMillis: () => number }).toMillis()
      : null;

  return { tokens, title, body, data, recipientUid, createdAtMs };
}

/**
 * Remove tokens FCM reported as permanently dead from BOTH the cross-readable
 * mirror and the owner-only canonical list, keeping the two in lockstep.
 *
 * Scoping note (security): the tokens passed here come either from the
 * recipient's own pushTargets doc (a dispatch that names no tokens, M1) or from
 * the doc's `tokens` array, which the /push_dispatch create rule pins to
 * `tokens.hasOnly(pushTargets[recipientUid].tokens)` for client writers. So a
 * crafted dispatch doc cannot make this prune an unrelated user's devices. The prune is further
 * gated on FCM itself declaring the token dead.
 */
export async function pruneDeadTokens(db: Firestore, recipientUid: string, dead: string[]): Promise<number> {
  if (dead.length === 0) return 0;
  try {
    await Promise.all([
      db
        .collection(PUSH_TARGETS_COLLECTION)
        .doc(recipientUid)
        .set(
          {
            tokens: FieldValue.arrayRemove(...dead),
            // Drop the dead tokens' platform tags too, so the map stays in step with the list.
            platforms: Object.fromEntries(dead.map((token) => [token, FieldValue.delete()])),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
      db
        .collection("users")
        .doc(recipientUid)
        .collection("private")
        .doc(PRIVATE_PROFILE_DOC_ID)
        .set({ fcmTokens: FieldValue.arrayRemove(...dead) }, { merge: true }),
    ]);
    return dead.length;
  } catch (err) {
    // Best-effort: a leaked stale token costs one wasted FCM call per dispatch
    // and is re-pruned on the next attempt. Never fail the drain over it.
    console.warn(
      JSON.stringify({
        event: "drain_prune_failed",
        recipientUid,
        code: safeErrorCode(err),
      }),
    );
    captureServerError("drain_prune_failed", err, { recipientUid }, { level: "warning" });
    return 0;
  }
}
