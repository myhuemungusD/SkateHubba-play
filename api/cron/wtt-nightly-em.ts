/**
 * WTT nightly Dawid-Skene EM processor (server cron).
 * Runs Expectation-Maximization to update voter reliability scores,
 * calculates Trick IQ, and processes daily streaks.
 *
 * NOT YET DEPLOYED — stubbed behind WTT_ENABLED flag.
 */

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { WTT_ENABLED } from "../../src/constants/wtt.config";

/**
 * Cron endpoint: nightly Dawid-Skene reliability update.
 * GET /api/cron/wtt-nightly-em
 *
 * Should be triggered once daily (e.g., 2am UTC) via Vercel cron.
 */
export default async function wttNightlyEm(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "GET" && req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  if (!WTT_ENABLED) {
    res.status(200).json({ message: "WTT disabled", processed: 0 });
    return;
  }

  console.log("[WTT] Starting wttNightlyEm cron");

  try {
    // TODO: Implement Dawid-Skene EM algorithm:
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
    res.status(200).json({
      message: "WTT nightly EM complete (stub)",
      usersUpdated,
      averageReliability,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[WTT] wttNightlyEm error:", error);
    res.status(500).json({
      error: "Failed to run WTT nightly EM",
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
