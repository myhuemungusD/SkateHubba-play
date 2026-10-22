import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDeleteUser, mockSignOut, mockCapture, authState } = vi.hoisted(() => ({
  mockDeleteUser: vi.fn(),
  mockSignOut: vi.fn(),
  mockCapture: vi.fn(),
  authState: { currentUser: null as { uid: string } | null },
}));

vi.mock("firebase/auth", () => ({ deleteUser: (u: unknown) => mockDeleteUser(u) }));
vi.mock("../../firebase", () => ({ requireAuth: () => authState }));
vi.mock("../../lib/sentry", () => ({ captureException: (...a: unknown[]) => mockCapture(...a) }));
vi.mock("../auth", () => ({ signOut: () => mockSignOut() }));
vi.mock("../logger", () => ({ logger: { info: vi.fn(), warn: vi.fn() } }));
const { mockMark } = vi.hoisted(() => ({ mockMark: vi.fn() }));
vi.mock("../../utils/coppaNotice", () => ({ markCoppaBlocked: () => mockMark() }));

import { blockUnderageSignIn } from "../auth.underage";

beforeEach(() => {
  vi.clearAllMocks();
  authState.currentUser = { uid: "kid" };
  mockDeleteUser.mockResolvedValue(undefined);
  mockSignOut.mockResolvedValue(undefined);
});

describe("blockUnderageSignIn", () => {
  it("deletes the Auth user, then clears the native session", async () => {
    expect(await blockUnderageSignIn()).toBe("deleted");
    expect(mockDeleteUser).toHaveBeenCalledWith({ uid: "kid" });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockCapture).not.toHaveBeenCalled();
    expect(mockMark).toHaveBeenCalledTimes(1);
  });

  it("still reports deleted when the follow-up sign-out fails", async () => {
    mockSignOut.mockRejectedValue(new Error("plugin"));
    expect(await blockUnderageSignIn()).toBe("deleted");
  });

  it("signs out and reports the orphan when the delete fails", async () => {
    mockDeleteUser.mockRejectedValue(Object.assign(new Error("old"), { code: "auth/requires-recent-login" }));
    expect(await blockUnderageSignIn()).toBe("signed_out");
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(expect.any(Error), {
      extra: { context: "blockUnderageSignIn", uid: "kid", code: "auth/requires-recent-login" },
    });
  });

  it("reports failed, without rejecting, when the delete and the sign-out both fail", async () => {
    mockDeleteUser.mockRejectedValue(new Error("offline"));
    mockSignOut.mockRejectedValue(new Error("offline"));
    expect(await blockUnderageSignIn()).toBe("failed");
  });

  it("does nothing with no one signed in", async () => {
    authState.currentUser = null;
    expect(await blockUnderageSignIn()).toBe("no_user");
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });
});
