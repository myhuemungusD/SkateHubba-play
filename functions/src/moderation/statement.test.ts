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
    const rejected = statementForAutoReject("clip 1", "VERY_LIKELY");
    expect(rejected.automated).toBe(true);
    expect(rejected.appealPath).toBe("/appeal/clip_clip%201");
    expect(notificationCopy(rejected).title).toBe("Clip rejected");

    const removed = statementForRemoval("c1", "not skating");
    expect(removed.automated).toBe(false);
    expect(notificationCopy(removed).title).toBe("Clip removed");
    expect(notificationCopy(removed).body).toContain("/appeal/clip_c1");

    expect(notificationCopy(statementForApproval()).title).toBe("Clip is live");
    expect(notificationCopy(statementForReview("c1", "no skateboard detected")).title).toBe("Clip in review");
  });

  it("keeps the notification body inside the bell limit", () => {
    const statement = statementForRemoval("c1", "x".repeat(500));
    expect(notificationCopy(statement).body.length).toBeLessThanOrEqual(200);
  });
});
