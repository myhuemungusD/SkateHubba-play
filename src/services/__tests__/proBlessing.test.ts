import { beforeEach, describe, expect, it, vi } from "vitest";

const getDocs = vi.fn();
const onSnapshot = vi.fn();
const callable = vi.fn();
vi.mock("firebase/firestore", () => ({
  collection: vi.fn(() => "col"),
  query: vi.fn(() => "q"),
  where: vi.fn(),
  limit: vi.fn(),
  getDocs: (...a: unknown[]) => getDocs(...a),
  onSnapshot: (...a: unknown[]) => onSnapshot(...a),
}));
vi.mock("firebase/functions", () => ({
  getFunctions: vi.fn(() => ({})),
  connectFunctionsEmulator: vi.fn(),
  httpsCallable: () => callable,
}));
const fb = vi.hoisted(() => ({ app: {} as object | null, emulator: false, dbThrows: false }));
vi.mock("../../firebase", () => ({
  get default() {
    return fb.app;
  },
  requireDb: () => {
    if (fb.dbThrows) throw new Error("no db");
    return {};
  },
  ensureAppCheck: () => Promise.resolve(),
  get isEmulatorMode() {
    return fb.emulator;
  },
}));
vi.mock("../../lib/sentry", () => ({ addBreadcrumb: vi.fn(), captureException: vi.fn() }));
vi.mock("../analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("../logger", () => ({ logger: { warn: vi.fn() } }));

import {
  ADMIN_REVOKE_REASON,
  answerBlessing,
  blessSkater,
  revokePro,
  blessingErrorMessage,
  fetchLineage,
  fetchMyBlessings,
  subscribeToPendingBlessings,
  toBlessing,
} from "../proBlessing";

const raw = (o: Record<string, unknown> = {}) => ({
  blesserUid: "p",
  blesserUsername: "pro",
  targetUid: "t",
  targetUsername: "kid",
  reason: "r",
  status: "accepted",
  createdAt: { toMillis: () => 5 },
  ...o,
});
const snap = (...rows: Array<Record<string, unknown>>) => ({
  docs: rows.map((r, i) => ({ id: `b${i}`, data: () => r })),
});

beforeEach(() => {
  Object.assign(fb, { app: {}, emulator: false, dbThrows: false });
  getDocs.mockReset();
  callable.mockReset();
  onSnapshot.mockReset();
});

describe("proBlessing service", () => {
  it("maps docs and rejects bad shapes", () => {
    expect(toBlessing("x", raw())).toMatchObject({ id: "x", status: "accepted", createdAtMs: 5 });
    expect(toBlessing("x", raw({ createdAt: 9 }))?.createdAtMs).toBe(9);
    expect(toBlessing("x", raw({ status: "bogus" }))).toBeNull();
    expect(toBlessing("x", raw({ blesserUid: "" }))).toBeNull();
    expect(toBlessing("x", undefined)).toBeNull();
  });

  it("walks lineage up the blesser chain and stops on loops", async () => {
    getDocs
      .mockResolvedValueOnce(snap(raw({ targetUid: "t", blesserUid: "a" })))
      .mockResolvedValueOnce(snap(raw({ targetUid: "a", blesserUid: "t" })));
    const chain = await fetchLineage("t");
    expect(chain.map((b) => b.blesserUid)).toEqual(["a"]);
    getDocs.mockResolvedValueOnce(snap());
    expect(await fetchLineage("t")).toEqual([]);
  });

  it("lists my blessings newest first", async () => {
    getDocs.mockResolvedValue(snap(raw({ createdAt: 1 }), raw({ createdAt: 3 }), { status: "nope" }));
    expect((await fetchMyBlessings("p")).map((b) => b.createdAtMs)).toEqual([3, 1]);
  });

  it("subscribes to pending offers", () => {
    const cb = vi.fn();
    onSnapshot.mockImplementation((_q, next) => {
      next(snap(raw({ status: "pending" })));
      return () => {};
    });
    subscribeToPendingBlessings("t", cb);
    expect(cb.mock.calls[0]?.[0]).toHaveLength(1);
  });

  it("calls the callable and maps errors to plain words", async () => {
    callable.mockResolvedValue({ data: { blessingId: "b9", status: "pending" } });
    expect(await blessSkater("t", "reason here!")).toBe("b9");
    expect(callable).toHaveBeenCalledWith({ action: "bless", targetUid: "t", reason: "reason here!" });
    callable.mockResolvedValue({ data: { blessingId: "b9", status: "accepted" } });
    expect(await answerBlessing("b9", true)).toBe("accepted");
    callable.mockResolvedValue({ data: null });
    await expect(answerBlessing("b9", false)).rejects.toThrow("bad response");
    expect(blessingErrorMessage(new Error("limit_reached"))).toMatch(/blessings for now/);
    expect(blessingErrorMessage("x")).toBe("That didn't work. Try again.");
  });

  it("revokes through the callable with a default audit reason", async () => {
    callable.mockResolvedValue({ data: { blessingId: "b2", status: "revoked" } });
    expect(await revokePro("t")).toBe("revoked");
    expect(callable).toHaveBeenCalledWith({ action: "revoke", targetUid: "t", reason: ADMIN_REVOKE_REASON });
    expect(ADMIN_REVOKE_REASON.length).toBeGreaterThanOrEqual(10);
  });

  it("handles listener errors, a missing db, a missing app and the emulator", async () => {
    onSnapshot.mockImplementation((_q, _next, err) => {
      err(new Error("denied"));
      err("weird");
      return () => {};
    });
    const cb = vi.fn();
    subscribeToPendingBlessings("t", cb);
    expect(cb).not.toHaveBeenCalled();
    fb.dbThrows = true;
    expect(subscribeToPendingBlessings("t", cb)()).toBeUndefined();
    fb.dbThrows = false;
    fb.emulator = true;
    callable.mockResolvedValue({ data: { status: "declined" } });
    expect(await answerBlessing("b1", false)).toBe("declined");
    fb.app = null;
    await expect(blessSkater("t", "reason here!")).rejects.toThrow("Firebase not initialized");
  });

  it("maps odd field types to safe defaults", () => {
    expect(toBlessing("x", raw({ createdAt: "soon", reason: 7 }))).toMatchObject({ createdAtMs: 0, reason: "" });
  });
});
