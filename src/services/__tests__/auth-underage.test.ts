import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  deleteUser: vi.fn(),
  signOut: vi.fn(),
  capture: vi.fn(),
  markNotice: vi.fn(),
  markSticky: vi.fn(),
  url: vi.fn(),
  fetch: vi.fn(),
  user: null as { uid: string; getIdToken: () => Promise<string> } | null,
}));

vi.mock("firebase/auth", () => ({ deleteUser: (u: unknown) => h.deleteUser(u) }));
vi.mock("../../firebase", () => ({
  requireAuth: () => ({
    get currentUser() {
      return h.user;
    },
  }),
}));
vi.mock("../../lib/sentry", () => ({ captureException: (...a: unknown[]) => h.capture(...a) }));
vi.mock("../auth", () => ({ signOut: () => h.signOut() }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("../auth.deleteAccount", async (orig) => ({
  ...(await orig<typeof import("../auth.deleteAccount")>()),
  accountDeleteUrl: () => h.url(),
}));
vi.mock("../../utils/coppaNotice", () => ({
  markCoppaBlocked: (o: string) => h.markNotice(o),
  markAgeGateBlocked: () => h.markSticky(),
}));

import { blockUnderageSignIn } from "../auth.underage";
import { hashUid } from "../../utils/pii";

const recentLogin = Object.assign(new Error("old"), { code: "auth/requires-recent-login" });
const json = (status: number, body: unknown) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { uid: "kid", getIdToken: async () => "tok" };
  h.deleteUser.mockResolvedValue(undefined);
  h.signOut.mockResolvedValue(undefined);
  h.url.mockReturnValue("https://skatehubba.com/api/account/delete");
  h.fetch.mockResolvedValue(json(200, { ok: true, authDeleted: true, mode: "underage" }));
  vi.stubGlobal("fetch", h.fetch);
});

describe("blockUnderageSignIn", () => {
  it("sets the sticky block, deletes on the client, then clears the native session", async () => {
    expect(await blockUnderageSignIn()).toBe("deleted");
    expect(h.markSticky).toHaveBeenCalledTimes(1);
    expect(h.markNotice.mock.calls).toEqual([["pending"], ["deleted"]]);
    expect(h.deleteUser).toHaveBeenCalledWith(h.user);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.capture).not.toHaveBeenCalled();
  });

  it("still reports deleted when the follow-up sign-out fails", async () => {
    h.signOut.mockRejectedValue(new Error("plugin"));
    expect(await blockUnderageSignIn()).toBe("deleted");
  });

  it("falls back to the server's underage mode when the sign-in is too old", async () => {
    h.deleteUser.mockRejectedValue(recentLogin);
    expect(await blockUnderageSignIn()).toBe("deleted");
    expect(h.fetch).toHaveBeenCalledWith("https://skatehubba.com/api/account/delete?reason=underage", {
      method: "POST",
      headers: { Authorization: "Bearer tok" },
    });
    expect(h.markNotice).toHaveBeenLastCalledWith("deleted");
    expect(h.signOut).toHaveBeenCalledTimes(1);
  });

  it("signs out, leaves the notice pending, and reports only the hashed uid when both deletes fail", async () => {
    h.deleteUser.mockRejectedValue(recentLogin);
    h.fetch.mockResolvedValue(json(500, { code: "erasure_failed" }));
    expect(await blockUnderageSignIn()).toBe("signed_out");
    expect(h.markNotice.mock.calls).toEqual([["pending"]]);
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.capture).toHaveBeenCalledWith(expect.any(Error), {
      extra: {
        context: "blockUnderageSignIn",
        uidHash: hashUid("kid"),
        clientCode: "auth/requires-recent-login",
        serverCode: "account-delete/erasure_failed",
      },
    });
    expect(JSON.stringify(h.capture.mock.calls)).not.toContain('"kid"');
  });

  it("uses the HTTP status when the server sends no code", async () => {
    h.deleteUser.mockRejectedValue(recentLogin);
    h.fetch.mockResolvedValue({ ok: false, status: 502, json: async () => Promise.reject(new Error("html")) });
    expect(await blockUnderageSignIn()).toBe("signed_out");
    expect(h.capture.mock.calls[0][1].extra.serverCode).toBe("account-delete/502");
  });

  it("does not call the server from a native build with no API origin", async () => {
    h.deleteUser.mockRejectedValue(recentLogin);
    h.url.mockReturnValue(null);
    expect(await blockUnderageSignIn()).toBe("signed_out");
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.capture.mock.calls[0][1].extra.serverCode).toBe("account-delete/misconfigured");
  });

  it("reports failed, without rejecting, when both deletes and the sign-out fail", async () => {
    h.deleteUser.mockRejectedValue(new Error("offline"));
    h.fetch.mockRejectedValue(new TypeError("offline"));
    h.signOut.mockRejectedValue(new Error("offline"));
    expect(await blockUnderageSignIn()).toBe("failed");
  });

  it("still sets the sticky block with no one signed in", async () => {
    h.user = null;
    expect(await blockUnderageSignIn()).toBe("no_user");
    expect(h.markSticky).toHaveBeenCalledTimes(1);
    expect(h.deleteUser).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
  });
});
