import { describe, expect, it } from "vitest";
import { AUTO_HIDE_REPORT_THRESHOLD, MIN_REPORTER_ACCOUNT_AGE_MS } from "./config.js";
import { countEligibleReporters } from "./reporters.js";

const DAY = MIN_REPORTER_ACCOUNT_AGE_MS;
const nowMs = 10 * DAY;

describe("countEligibleReporters", () => {
  it("counts distinct established reporters and ignores the owner, dupes, new accounts, and other reasons", () => {
    const counted = countEligibleReporters({
      ownerUid: "owner",
      nowMs,
      accountCreatedAtMs: new Map([
        ["owner", nowMs - 10 * DAY],
        ["a", nowMs - 2 * DAY],
        ["b", nowMs - 3 * DAY],
        ["c", nowMs - 1000],
        ["d", null],
        ["e", nowMs - 5 * DAY],
      ]),
      reports: [
        { reporterUid: "owner", reason: "not_skating" },
        { reporterUid: "a", reason: "not_skating" },
        { reporterUid: "a", reason: "inappropriate" },
        { reporterUid: "b", reason: "non_skate_content" },
        { reporterUid: "c", reason: "inappropriate_video" },
        { reporterUid: "d", reason: "not_skating" },
        { reporterUid: "e", reason: "cheating" },
        { reporterUid: "", reason: "not_skating" },
      ],
    });
    expect(counted.count).toBe(2);
    expect(counted.reasons.sort()).toEqual(["non_skate_content", "not_skating"]);
    expect(counted.count).toBeLessThan(AUTO_HIDE_REPORT_THRESHOLD);
  });

  it("reaches the default threshold of three", () => {
    const counted = countEligibleReporters({
      ownerUid: "owner",
      nowMs,
      accountCreatedAtMs: new Map([
        ["a", nowMs - DAY],
        ["b", nowMs - DAY],
        ["c", nowMs - DAY],
      ]),
      reports: [
        { reporterUid: "a", reason: "not_skating" },
        { reporterUid: "b", reason: "inappropriate" },
        { reporterUid: "c", reason: "inappropriate_video" },
      ],
    });
    expect(counted.count).toBe(AUTO_HIDE_REPORT_THRESHOLD);
  });
});
