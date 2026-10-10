import { AUTO_HIDE_REPORT_THRESHOLD } from "./config.js";
import { autoHidePatch, shouldAutoHideClip, type SaveGuard } from "./patches.js";
import { countEligibleReporters, type ClipReportRow } from "./reporters.js";

export interface ReportModerationInput {
  enabled: boolean;
  clipId: string;
  reason: string;
  loadClip: () => Promise<Record<string, unknown> | null>;
  loadReports: () => Promise<ClipReportRow[]>;
  loadCreatedAt: (uid: string) => Promise<number | null>;
  nowMs: number;
  threshold?: number;
  save: (patch: Record<string, unknown>, guard: SaveGuard) => Promise<boolean>;
}

/**
 * Hide a public clip once enough distinct, established accounts have reported
 * it. Game clips and dispute clips are ignored here — their reports stay in
 * the admin reports queue. The owner's own report never counts.
 */
export async function runReportModeration(input: ReportModerationInput): Promise<"hidden" | "ignored"> {
  if (!input.enabled) return "ignored";
  if (input.clipId.length === 0) return "ignored";
  const clip = await input.loadClip();
  if (!clip || !shouldAutoHideClip(clip)) return "ignored";
  const ownerUid = typeof clip.playerUid === "string" ? clip.playerUid : "";
  const reports = await input.loadReports();
  const createdAt = new Map<string, number | null>();
  for (const report of reports) {
    if (createdAt.has(report.reporterUid)) continue;
    createdAt.set(report.reporterUid, await input.loadCreatedAt(report.reporterUid));
  }
  const counted = countEligibleReporters({
    reports,
    ownerUid,
    nowMs: input.nowMs,
    accountCreatedAtMs: createdAt,
  });
  const threshold = input.threshold ?? AUTO_HIDE_REPORT_THRESHOLD;
  if (counted.count < threshold) return "ignored";
  const built = autoHidePatch(counted.reasons);
  const applied = await input.save(built.patch, built.guard);
  return applied ? "hidden" : "ignored";
}
