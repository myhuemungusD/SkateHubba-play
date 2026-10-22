/**
 * WTT nightly Dawid-Skene EM processor (server cron).
 * Runs Expectation-Maximization to update voter reliability scores,
 * calculates Trick IQ, and processes daily streaks.
 *
 * NOT YET DEPLOYED — stubbed behind WTT_ENABLED flag.
 */

import { isCronAuthorized } from "./_cronAuth.js";
import { wttFailureResponse } from "./_wttFailure.js";

// WTT_ENABLED would be imported from config when this is deployed
const WTT_ENABLED = false;

/**
 * Cron endpoint: nightly Dawid-Skene reliability update.
 * GET /api/cron/wtt-nightly-em
 *
 * Should be triggered once daily (e.g., 2am UTC) via GitHub Actions.
 */
export async function wttNightlyEm(req: Request): Promise<Response> {
  // Auth first, then verb, like the other crons: an unauthenticated caller
  // gets 401 and never learns which verbs are allowed.
  if (!isCronAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // GET only, like the live crons (Vercel Cron sends GET); POST included gets 405.
  if (req.method !== "GET") {
    return Response.json({ error: "method_not_allowed" }, { status: 405 });
  }

  // Disabled: return at once with 204 No Content. Nothing to do, nothing to say.
  if (!WTT_ENABLED) {
    return new Response(null, { status: 204 });
  }

  console.log("[WTT] Starting wttNightlyEm cron");

  try {
    // IMPLEMENTATION PENDING (Dawid-Skene EM algorithm):
    //
    // 1. Fetch all wttGold items (gold-standard answers from verified pros)
    // 2. Fetch all wttVotes on those gold items
    // 3. Build voter confusion matrices:
    //    - For each voter, track: how often they chose X when answer was Y
    //    - Initialize with uniform priors (assume everyone is equally good)
    // 4. Run EM iterations (usually 10-20 iterations converge):
    //    E-step: Estimate true labels given current confusion matrices
    //    M-step: Re-estimate confusion matrices given current label estimates
    // 5. Calculate reliability score per voter:
    //    - reliabilityScore = P(correct | voter's history)
    //    - Range [0, 1]; 0.5 = random guessing, 1.0 = perfect
    // 6. Write updated scores to users/{uid}/private/wtt:
    //    {
    //      reliabilityScore: number,
    //      votesSubmitted: number,
    //      goldCorrect: number,
    //      confusionMatrix: {...},  // Optional: full matrix for debugging
    //      trickIq: number,         // Scaled 0-100 for gamification
    //      updatedAt: serverTimestamp()
    //    }
    // 7. Process daily streaks:
    //    - For users who voted yesterday, increment/reset streak
    //    - Award streak badges/XP if streak milestones hit
    // 8. Clean up: archive retired wttItems older than 90 days

    const usersUpdated = 0; // Stub
    const averageReliability = 0.0; // Stub

    console.log(`[WTT] wttNightlyEm complete: ${usersUpdated} users, avg reliability ${averageReliability}`);
    return Response.json({
      message: "WTT nightly EM complete (stub)",
      usersUpdated,
      averageReliability,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Never error.message, in the log or the body (api/_safeError.ts).
    return wttFailureResponse("wtt_nightly_em_failed", error, "Failed to run WTT nightly EM");
  }
}

/**
 * Web-signature export. Vercel treats a default-exported *function* as a Node
 * `(req, res)` handler and ignores its return value, so a function that
 * returns a `Response` never ends `res` and the request hangs until the
 * function times out. `export default { fetch }` is the Web `Request` ->
 * `Response` form Vercel's Node.js runtime awaits and sends.
 */
export default { fetch: wttNightlyEm };
