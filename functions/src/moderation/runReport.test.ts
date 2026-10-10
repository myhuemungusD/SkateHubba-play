import { describe, expect, it, vi } from "vitest";
import { runReportModeration } from "./runReport.js";

const DAY = 24 * 60 * 60 * 1000;
const nowMs = 10 * DAY;

function reporter(uid: string, reason = "not_skating") {
  return { reporterUid: uid, reason };
}

describe("runReportModeration", () => {
  it("ignores the switch-off path, missing clips, and clips that are not public user uploads", async () => {
    const save = vi.fn(async () => true);
    await expect(
      runReportModeration({
        enabled: false,
        clipId: "c1",
        reason: "not_skating",
        loadClip: async () => ({ source: "user", moderation: "approved", playerUid: "owner" }),
        loadReports: async () => [],
        loadCreatedAt: async () => nowMs - 2 * DAY,
        nowMs,
        save,
      }),
    ).resolves.toBe("ignored");

    await expect(
      runReportModeration({
        enabled: true,
        clipId: "",
        reason: "not_skating",
        loadClip: async () => null,
        loadReports: async () => [],
        loadCreatedAt: async () => null,
        nowMs,
        save,
      }),
    ).resolves.toBe("ignored");

    await expect(
      runReportModeration({
        enabled: true,
        clipId: "gameClip",
        reason: "not_skating",
        loadClip: async () => ({ source: "game", moderation: "active", playerUid: "owner" }),
        loadReports: async () => [reporter("a"), reporter("b"), reporter("c")],
        loadCreatedAt: async () => nowMs - 2 * DAY,
        nowMs,
        save,
      }),
    ).resolves.toBe("ignored");
    expect(save).not.toHaveBeenCalled();
  });

  it("hides a public clip once three established reporters agree, and not before", async () => {
    const save = vi.fn(async () => true);
    const base = {
      enabled: true,
      clipId: "c1",
      reason: "not_skating",
      loadClip: async () => ({ source: "user", moderation: "approved", playerUid: "owner" }),
      loadCreatedAt: async (uid: string) => (uid === "new" ? nowMs - 1000 : nowMs - 3 * DAY),
      nowMs,
      save,
    };

    await expect(
      runReportModeration({
        ...base,
        loadReports: async () => [reporter("a"), reporter("a", "inappropriate"), reporter("owner"), reporter("new")],
      }),
    ).resolves.toBe("ignored");

    await expect(
      runReportModeration({
        ...base,
        loadReports: async () => [reporter("a"), reporter("b", "inappropriate"), reporter("c", "non_skate_content")],
      }),
    ).resolves.toBe("hidden");
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ moderation: "review", moderationStatus: "hidden" }),
      "hide-if-open",
    );
  });

  it("does not claim a hide when the clip was already in review", async () => {
    const save = vi.fn(async () => false);
    await expect(
      runReportModeration({
        enabled: true,
        clipId: "c1",
        reason: "inappropriate",
        loadClip: async () => ({ source: "user", moderation: "approved", playerUid: "owner" }),
        loadReports: async () => [reporter("a"), reporter("b"), reporter("c")],
        loadCreatedAt: async () => nowMs - 3 * DAY,
        nowMs,
        save,
      }),
    ).resolves.toBe("ignored");
  });
});
