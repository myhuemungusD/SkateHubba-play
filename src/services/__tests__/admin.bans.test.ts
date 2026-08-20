/**
 * Account bans — `src/services/admin.bans.ts`.
 *
 * The payload assertions are the point: the `users` update rule pins the
 * affected-key set, so an extra field here is a `permission-denied` for
 * every moderator in production.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { captureTxOnce, mockDoc, mockRunTransaction } from "./firestoreDoc.test-helpers";

import { banUser, unbanUser } from "../admin.bans";
import { logger } from "../logger";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("banUser / unbanUser", () => {
  it("writes exactly { banned: true } on the target's profile", async () => {
    const cap = captureTxOnce({ users: { exists: true, data: { username: "alice" } } });

    await banUser("target");

    expect(mockDoc).toHaveBeenCalledWith(expect.anything(), "users", "target");
    expect(cap.observed().update).toHaveBeenCalledWith(expect.objectContaining({ __path: "users/target" }), {
      banned: true,
    });
  });

  it("writes { banned: false } on unban rather than removing the field", async () => {
    const cap = captureTxOnce({ users: { exists: true, data: {} } });

    await unbanUser("target");

    expect(cap.observed().update).toHaveBeenCalledWith(expect.anything(), { banned: false });
  });

  it("fails on a missing profile instead of creating a stray field", async () => {
    // Real runTransaction propagates whatever the callback throws.
    mockRunTransaction.mockImplementationOnce(async (_db: unknown, cb: (tx: unknown) => Promise<void>) => {
      await cb({
        get: vi.fn().mockResolvedValue({ exists: () => false }),
        update: vi.fn(),
        set: vi.fn(),
        delete: vi.fn(),
      });
    });
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(banUser("ghost")).rejects.toThrow(/no longer exists/);

    expect(warn).toHaveBeenCalledWith(
      "admin_ban_write_failed",
      expect.objectContaining({ targetUid: "ghost", banned: true }),
    );
    warn.mockRestore();
  });

  it("rejects an unusable uid before any network call", async () => {
    await expect(banUser("")).rejects.toThrow(/Invalid target uid/);
    await expect(banUser("a/b")).rejects.toThrow(/Invalid target uid/);
    await expect(unbanUser(undefined as unknown as string)).rejects.toThrow(/Invalid target uid/);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("logs and rethrows a rejected transaction", async () => {
    mockRunTransaction.mockRejectedValueOnce(Object.assign(new Error("denied"), { code: "permission-denied" }));
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await expect(unbanUser("target")).rejects.toThrow(/denied/);

    expect(warn).toHaveBeenCalledWith(
      "admin_ban_write_failed",
      expect.objectContaining({ targetUid: "target", banned: false }),
    );
    warn.mockRestore();
  });
});
