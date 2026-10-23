import { describe, expect, it, vi } from "vitest";
import type { ReportModerationInput } from "./runReport.js";

const runReportModeration = vi.fn<(input: ReportModerationInput) => Promise<void>>(async () => undefined);

vi.mock("./runReport.js", () => ({
  runReportModeration: (input: ReportModerationInput) => runReportModeration(input),
}));
vi.mock("firebase-admin/auth", () => ({ getAuth: () => ({ getUser: async () => ({ metadata: {} }) }) }));

const { handleClipReport } = await import("./handlers.js");

function dbWithReports(reports: Record<string, unknown>[]) {
  const get = vi.fn(async () => ({ docs: reports.map((data) => ({ data: () => data })) }));
  const where = vi.fn(() => ({ get }));
  const collection = vi.fn(() => ({ where }));
  return { db: { collection } as never, where };
}

describe("handleClipReport and comment reports", () => {
  it("never runs clip moderation for a report on a single comment", async () => {
    runReportModeration.mockClear();
    const { db } = dbWithReports([]);
    await handleClipReport({ db, enabled: true, sentryDsn: "" }, { clipId: "c1", commentId: "cm1", reason: "x" }, 0);
    expect(runReportModeration).not.toHaveBeenCalled();
  });

  it("leaves comment reports out of the clip's report count", async () => {
    runReportModeration.mockClear();
    const { db, where } = dbWithReports([
      { reporterUid: "a", reason: "inappropriate" },
      { reporterUid: "b", reason: "inappropriate", commentId: "cm1" },
      { reporterUid: "c", reason: "inappropriate", commentId: "" },
    ]);
    await handleClipReport({ db, enabled: true, sentryDsn: "" }, { clipId: "c1", reason: "inappropriate" }, 0);
    const input = runReportModeration.mock.calls[0]?.[0];
    await expect(input?.loadReports()).resolves.toEqual([
      { reporterUid: "a", reason: "inappropriate" },
      { reporterUid: "c", reason: "inappropriate" },
    ]);
    expect(where).toHaveBeenCalledWith("clipId", "==", "c1");
  });
});
