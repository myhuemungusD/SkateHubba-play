import { describe, expect, it } from "vitest";
import {
  notificationCopy,
  statementForApproval,
  statementForAutoReject,
  statementForRemoval,
  statementForReview,
} from "./statement.js";

describe("statement of reasons", () => {
  it("names the decision, says when a machine made it, and includes the appeal path", () => {
    const rejected = statementForAutoReject("VERY_LIKELY");
    expect(rejected.automated).toBe(true);
    expect(rejected.appealPath).toBe("/settings#safety-reports");
    expect(notificationCopy(rejected).title).toBe("Clip rejected");
    expect(notificationCopy(rejected).body).toContain("Appeal it in Settings.");

    const removed = statementForRemoval("not skating");
    expect(removed.automated).toBe(false);
    expect(removed.appealPath).toBe("/settings#safety-reports");
    expect(notificationCopy(removed).title).toBe("Clip removed");
    expect(notificationCopy(removed).body).toContain("Appeal it in Settings.");

    expect(notificationCopy(statementForApproval()).title).toBe("Clip is live");
    expect(notificationCopy(statementForReview("no skateboard detected")).title).toBe("Clip in review");
  });

  it("keeps the notification body inside the bell limit", () => {
    const statement = statementForRemoval("x".repeat(500));
    expect(notificationCopy(statement).body.length).toBeLessThanOrEqual(200);
  });
});
