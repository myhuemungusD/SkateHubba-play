/**
 * WTT item builder (server cron).
 * Generates quiz items from labeled clips for the WTT feed.
 * Runs hourly or on-demand to populate wttItems collection.
 *
 * NOT YET DEPLOYED — stubbed behind WTT_ENABLED flag.
 */

import { wttFailureResponse } from "./_wttFailure.js";

// WTT_ENABLED would be imported from config when this is deployed
const WTT_ENABLED = false;

/**
 * Cron endpoint: builds WTT quiz items from eligible clips.
 * GET /api/cron/build-wtt-items
 *
 * Should be triggered hourly via GitHub Actions or similar scheduler.
 */
export default async function buildWttItems(req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (!WTT_ENABLED) {
    return Response.json({ message: "WTT disabled", processed: 0 });
  }

  console.log("[WTT] Starting buildWttItems cron");

  try {
    // IMPLEMENTATION PENDING:
    // 1. Query clips collection for:
    //    - Clips with trickId set (from trick picker)
    //    - Not already in wttItems or wttGold
    //    - playerUid has trainingConsentOptedIn=true
    //    - createdAt within last N days (freshness window)
    // 2. For each eligible clip:
    //    - Generate 3 distractor options using TRICK_CONFUSION_MAP
    //    - Create wttItems/{clipId} document:
    //      {
    //        clipId,
    //        correctTrickId: clip.trickId,
    //        options: [correct, distractor1, distractor2, distractor3] (shuffled),
    //        voteCount: 0,
    //        consensus: null,
    //        retired: false,
    //        createdAt: serverTimestamp()
    //      }
    // 3. Check for gold-standard clips (uploaded by WTT_GOLD_PROS):
    //    - If clip.playerUid in WTT_GOLD_PROS:
    //      - Create wttGold/{clipId} document instead of wttItems
    //      - These are used to calculate voter reliability scores
    // 4. Batch write all new items (max 500 per run to avoid timeouts)
    // 5. Log stats: items created, gold items created, clips skipped

    const itemsCreated = 0; // Stub
    const goldItemsCreated = 0; // Stub

    console.log(`[WTT] buildWttItems complete: ${itemsCreated} items, ${goldItemsCreated} gold`);
    return Response.json({
      message: "WTT items built (stub)",
      itemsCreated,
      goldItemsCreated,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Never error.message, in the log or the body (api/_safeError.ts).
    return wttFailureResponse("wtt_build_items_failed", error, "Failed to build WTT items");
  }
}
