import { CLIP_REPORT_REASONS, MIN_REPORTER_ACCOUNT_AGE_MS } from "./config.js";

export interface ClipReportRow {
  reporterUid: string;
  reason: string;
}

/**
 * Distinct reporters of this clip whose accounts are old enough to count.
 * The owner never counts. A second report from the same uid does not count
 * twice. Missing or unreadable account ages do not count.
 */
export function countEligibleReporters(input: {
  reports: readonly ClipReportRow[];
  ownerUid: string;
  nowMs: number;
  accountCreatedAtMs: ReadonlyMap<string, number | null>;
  minAgeMs?: number;
  reasons?: readonly string[];
}): { count: number; reasons: string[] } {
  const reasonSet = new Set(input.reasons ?? CLIP_REPORT_REASONS);
  const minAgeMs = input.minAgeMs ?? MIN_REPORTER_ACCOUNT_AGE_MS;
  const seen = new Set<string>();
  const countedReasons = new Set<string>();
  for (const report of input.reports) {
    if (!reasonSet.has(report.reason)) continue;
    if (report.reporterUid.length === 0 || report.reporterUid === input.ownerUid) continue;
    if (seen.has(report.reporterUid)) continue;
    const created = input.accountCreatedAtMs.get(report.reporterUid);
    if (created === undefined || created === null) continue;
    if (input.nowMs - created < minAgeMs) continue;
    seen.add(report.reporterUid);
    countedReasons.add(report.reason);
  }
  return { count: seen.size, reasons: [...countedReasons] };
}
