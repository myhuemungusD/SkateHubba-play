/**
 * Account bans — `src/services/admin.bans.ts`.
 *
 * Two things are asserted hard here:
 *
 *   1. The `bans/{uid}` tombstone payload. The create rule pins the key set
 *      to exactly ['bannedBy','bannedAt','reason'] with `bannedBy` equal to
 *      the caller — a drifted payload is a runtime `permission-denied` for
 *      every moderator, invisible to the type checker.
 *   2. That the tombstone still lands when the profile mirror can't be
 *      written. The whole reason this collection exists is that a subject
 *      can delete their profile; a ban that fails because of the missing
 *      mirror would reopen the exact bypass the tombstone was added to
 *      close.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDoc, mockDeleteDoc, mockUpdateDoc, mockWriteBatch, batchSet, batchUpdate, batchDelete, batchCommit } =
  vi.hoisted(() => {
    const batchSet = vi.fn();
    const batchUpdate = vi.fn();
    const batchDelete = vi.fn();
    const batchCommit = vi.fn().mockResolvedValue(undefined);
    return {
      mockDoc: vi.fn((_db: unknown, ...path: string[]) => ({ __path: path.join("/") })),
      mockDeleteDoc: vi.fn().mockResolvedValue(undefined),
      mockUpdateDoc: vi.fn().mockResolvedValue(undefined),
      mockWriteBatch: vi.fn(() => ({
        set: batchSet,
        update: batchUpdate,
        delete: batchDelete,
        commit: batchCommit,
      })),
      batchSet,
      batchUpdate,
      batchDelete,
      batchCommit,
    };
  });

vi.mock("firebase/firestore", () => ({
  deleteDoc: mockDeleteDoc,
  doc: mockDoc,
  serverTimestamp: () => "SERVER_TS",
  updateDoc: mockUpdateDoc,
  writeBatch: mockWriteBatch,
}));

const { mockCurrentUser } = vi.hoisted(() => ({
  mockCurrentUser: { value: { uid: "admin-1" } as { uid: string } | null },
}));

vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
  requireAuth: () => ({ currentUser: mockCurrentUser.value }),
}));

import { banUser, syncBanMirror, unbanUser } from "../admin.bans";
import { logger } from "../logger";

/** Firestore's rejection when an update targets a doc that isn't there. */
function missingDocError(): Error {
  return Object.assign(new Error("denied"), { code: "permission-denied" });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCurrentUser.value = { uid: "admin-1" };
  batchCommit.mockResolvedValue(undefined);
  mockDeleteDoc.mockResolvedValue(undefined);
  mockUpdateDoc.mockResolvedValue(undefined);
});

/* ── banUser ────────────────────────────────────────────────── */

describe("banUser", () => {
  it("writes the tombstone and the profile mirror in one batch", async () => {
    await banUser("target");

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "bans", "target");
    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "users", "target");
    expect(batchSet).toHaveBeenCalledWith(expect.objectContaining({ __path: "bans/target" }), {
      bannedBy: "admin-1",
      bannedAt: "SERVER_TS",
    });
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ __path: "users/target" }), { banned: true });
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it("stamps bannedBy with the CALLER's uid, not a parameter", async () => {
    mockCurrentUser.value = { uid: "admin-2" };

    await banUser("target");

    expect(batchSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bannedBy: "admin-2" }));
  });

  it("includes a trimmed reason when one is supplied", async () => {
    await banUser("target", "  posting non-skate content  ");

    expect(batchSet).toHaveBeenCalledWith(expect.anything(), {
      bannedBy: "admin-1",
      bannedAt: "SERVER_TS",
      reason: "posting non-skate content",
    });
  });

  it("OMITS the reason key when it is absent or blank", async () => {
    // `hasOnly` permits the key's absence but the type guard rejects a
    // non-string, so a null or "" here would fail the write outright.
    await banUser("target", "   ");
    expect(batchSet.mock.calls[0][1]).not.toHaveProperty("reason");

    await banUser("target", undefined);
    expect(batchSet.mock.calls[1][1]).not.toHaveProperty("reason");
  });

  it("rejects an over-long reason before any network call", async () => {
    await expect(banUser("target", "x".repeat(501))).rejects.toThrow(/500 characters/);
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it("accepts a reason of exactly the cap", async () => {
    await banUser("target", "x".repeat(500));

    expect(batchSet).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reason: "x".repeat(500) }));
  });

  it("refuses to ban your own account (four-eyes)", async () => {
    await expect(banUser("admin-1")).rejects.toThrow(/your own account/);
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it("requires a signed-in moderator", async () => {
    mockCurrentUser.value = null;

    await expect(banUser("target")).rejects.toThrow(/must be signed in/);
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it("rejects an unusable uid", async () => {
    await expect(banUser("")).rejects.toThrow(/Invalid target uid/);
    await expect(banUser("a/b")).rejects.toThrow(/Invalid target uid/);
    await expect(banUser(undefined as unknown as string)).rejects.toThrow(/Invalid target uid/);
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });
});

/* ── banUser: the missing-profile fallback ──────────────────── */

describe("banUser (profile mirror unavailable)", () => {
  it("still lands the tombstone when the mirror update is refused", async () => {
    // The subject deleted their profile — the exact bypass the tombstone
    // collection exists to close. The ban MUST survive it.
    batchCommit.mockRejectedValueOnce(missingDocError());
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(banUser("ghost", "spam")).resolves.toBeUndefined();

    expect(batchCommit).toHaveBeenCalledTimes(2);
    // Retry carries the identical payload and no mirror write.
    expect(batchSet).toHaveBeenLastCalledWith(expect.objectContaining({ __path: "bans/ghost" }), {
      bannedBy: "admin-1",
      bannedAt: "SERVER_TS",
      reason: "spam",
    });
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("admin_ban_mirror_skipped", expect.objectContaining({ targetUid: "ghost" }));
    warn.mockRestore();
  });

  it("falls back on not-found too", async () => {
    batchCommit.mockRejectedValueOnce(Object.assign(new Error("gone"), { code: "not-found" }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(banUser("ghost")).resolves.toBeUndefined();

    expect(batchCommit).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("reports the ORIGINAL failure when the tombstone-only retry is refused too", async () => {
    // A genuinely unauthorized caller: both attempts fail, and the error the
    // operator sees describes the real attempt.
    batchCommit.mockRejectedValue(missingDocError());
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(banUser("target")).rejects.toThrow(/denied/);

    expect(batchCommit).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith("admin_ban_write_failed", expect.objectContaining({ targetUid: "target" }));
    expect(warn).not.toHaveBeenCalledWith("admin_ban_mirror_skipped", expect.anything());
    warn.mockRestore();
  });

  it("does not retry a transport error — that is not a mirror problem", async () => {
    batchCommit.mockRejectedValueOnce(Object.assign(new Error("offline"), { code: "unavailable" }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(banUser("target")).rejects.toThrow(/offline/);

    expect(batchCommit).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith("admin_ban_write_failed", expect.anything());
    warn.mockRestore();
  });
});

/* ── unbanUser ──────────────────────────────────────────────── */

describe("unbanUser", () => {
  it("deletes the tombstone and clears the mirror in one batch", async () => {
    await unbanUser("target");

    expect(batchDelete).toHaveBeenCalledWith(expect.objectContaining({ __path: "bans/target" }));
    expect(batchUpdate).toHaveBeenCalledWith(expect.objectContaining({ __path: "users/target" }), { banned: false });
    expect(batchCommit).toHaveBeenCalledTimes(1);
    // Never an in-place edit of the ban doc — `allow update: if false`.
    expect(batchSet).not.toHaveBeenCalled();
  });

  it("drops the tombstone on its own when the mirror is unavailable", async () => {
    batchCommit.mockRejectedValueOnce(missingDocError());
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(unbanUser("ghost")).resolves.toBeUndefined();

    expect(mockDeleteDoc).toHaveBeenCalledWith(expect.objectContaining({ __path: "bans/ghost" }));
    expect(warn).toHaveBeenCalledWith("admin_ban_mirror_skipped", expect.objectContaining({ targetUid: "ghost" }));
    warn.mockRestore();
  });

  it("reports the original failure when the bare delete is refused too", async () => {
    batchCommit.mockRejectedValueOnce(missingDocError());
    mockDeleteDoc.mockRejectedValueOnce(missingDocError());
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(unbanUser("target")).rejects.toThrow(/denied/);

    expect(warn).toHaveBeenCalledWith("admin_unban_write_failed", expect.objectContaining({ targetUid: "target" }));
    warn.mockRestore();
  });

  it("refuses to unban your own account (four-eyes)", async () => {
    await expect(unbanUser("admin-1")).rejects.toThrow(/your own account/);
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it("rejects an unusable uid and requires a signed-in moderator", async () => {
    await expect(unbanUser("a/b")).rejects.toThrow(/Invalid target uid/);

    mockCurrentUser.value = null;
    await expect(unbanUser("target")).rejects.toThrow(/must be signed in/);
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });
});

/* ── syncBanMirror ──────────────────────────────────────────── */

describe("syncBanMirror", () => {
  it("writes only the mirror field", async () => {
    await syncBanMirror("target", true);

    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.objectContaining({ __path: "users/target" }), { banned: true });
    expect(mockWriteBatch).not.toHaveBeenCalled();
  });

  it("clears the mirror when asked", async () => {
    await syncBanMirror("target", false);

    expect(mockUpdateDoc).toHaveBeenCalledWith(expect.anything(), { banned: false });
  });

  it("logs and rethrows a refused write", async () => {
    mockUpdateDoc.mockRejectedValueOnce(missingDocError());
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(syncBanMirror("target", true)).rejects.toThrow(/denied/);

    expect(warn).toHaveBeenCalledWith(
      "admin_ban_mirror_sync_failed",
      expect.objectContaining({ targetUid: "target", banned: true }),
    );
    warn.mockRestore();
  });

  it("applies the same uid and four-eyes guards", async () => {
    await expect(syncBanMirror("", true)).rejects.toThrow(/Invalid target uid/);
    await expect(syncBanMirror("admin-1", true)).rejects.toThrow(/your own account/);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});
