import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  addDoc: vi.fn(),
  getDocs: vi.fn(),
  updateDoc: vi.fn(),
  callable: vi.fn(),
  connect: vi.fn(),
  record: vi.fn(),
  uid: "a1" as string | null,
  app: {} as object | null,
  emulator: false,
}));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...p: string[]) => p.join("/"),
  doc: (_db: unknown, ...p: string[]) => p.join("/"),
  where: (...a: unknown[]) => ({ where: a }),
  orderBy: (...a: unknown[]) => ({ orderBy: a }),
  limit: (n: number) => ({ limit: n }),
  query: (...a: unknown[]) => a,
  serverTimestamp: () => "TS",
  addDoc: h.addDoc,
  getDocs: h.getDocs,
  updateDoc: h.updateDoc,
}));
vi.mock("firebase/functions", () => ({
  getFunctions: vi.fn(() => ({})),
  connectFunctionsEmulator: h.connect,
  httpsCallable: () => h.callable,
}));
vi.mock("../../firebase", () => ({
  get default() {
    return h.app;
  },
  requireDb: () => ({}),
  requireAuth: () => ({ currentUser: h.uid ? { uid: h.uid } : null }),
  ensureAppCheck: () => Promise.resolve(),
  get isEmulatorMode() {
    return h.emulator;
  },
}));
vi.mock("../admin.audit", () => ({ recordAdminAction: h.record }));

import {
  createAnnouncement,
  dismissAnnouncement,
  dismissedAnnouncements,
  endAnnouncement,
  fetchAnalytics,
  getActiveAnnouncement,
  listAnnouncements,
} from "../adminInsights";

const ts = (ms: number) => ({ toMillis: () => ms });
const docs = (rows: [string, Record<string, unknown>][]) => ({ docs: rows.map(([id, d]) => ({ id, data: () => d })) });

beforeEach(() => {
  vi.clearAllMocks();
  h.uid = "a1";
  h.app = {};
  h.emulator = false;
  localStorage.clear();
  h.addDoc.mockResolvedValue({ id: "n1" });
});

describe("createAnnouncement", () => {
  it("validates, writes and audits", async () => {
    const input = { title: " Jam ", body: " Sat ", audience: "all" as const, push: true };
    expect(await createAnnouncement(input)).toBe("n1");
    expect(h.addDoc.mock.calls[0][1]).toEqual({
      title: "Jam",
      body: "Sat",
      audience: "all",
      push: true,
      active: true,
      createdBy: "a1",
      createdAt: "TS",
    });
    expect(h.record).toHaveBeenCalledWith("announce", "n1", "all +push: Jam");
    await createAnnouncement({ ...input, push: false, audience: "pros" });
    expect(h.record).toHaveBeenLastCalledWith("announce", "n1", "pros: Jam");
  });
  it("rejects bad input and signed-out admins", async () => {
    const ok = { title: "t", body: "b", audience: "all" as const, push: false };
    await expect(createAnnouncement({ ...ok, title: " " })).rejects.toThrow("Title");
    await expect(createAnnouncement({ ...ok, title: "x".repeat(81) })).rejects.toThrow("Title");
    await expect(createAnnouncement({ ...ok, body: "" })).rejects.toThrow("Message");
    await expect(createAnnouncement({ ...ok, body: "x".repeat(241) })).rejects.toThrow("Message");
    await expect(createAnnouncement({ ...ok, audience: "x" as never })).rejects.toThrow("Pick");
    h.uid = null;
    await expect(createAnnouncement(ok)).rejects.toThrow("Sign in");
    expect(h.addDoc).not.toHaveBeenCalled();
  });
});

describe("end + list", () => {
  it("ends one and audits it", async () => {
    await endAnnouncement("a9");
    expect(h.updateDoc).toHaveBeenCalledWith("announcements/a9", { active: false });
    expect(h.record).toHaveBeenCalledWith("end_announcement", "a9");
  });
  it("maps rows defensively", async () => {
    h.getDocs.mockResolvedValue(
      docs([
        ["a", { title: "T", body: "B", audience: "pros", push: true, active: true, pushCount: 3, createdAt: ts(5) }],
        ["b", { audience: "weird", title: 1 }],
      ]),
    );
    const rows = await listAnnouncements();
    expect(rows[0]).toEqual({
      id: "a",
      title: "T",
      body: "B",
      audience: "pros",
      push: true,
      active: true,
      pushCount: 3,
      createdAtMs: 5,
    });
    expect(rows[1]).toMatchObject({
      audience: "all",
      title: "",
      push: false,
      active: false,
      pushCount: null,
      createdAtMs: null,
    });
  });
});

describe("getActiveAnnouncement", () => {
  it("picks the newest one in the viewer's audience", async () => {
    h.getDocs.mockResolvedValue(
      docs([
        ["all-old", { audience: "all", createdAt: ts(1) }],
        ["pros", { audience: "pros", createdAt: ts(9) }],
        ["testers", { audience: "testers", createdAt: ts(8) }],
        ["nots", { audience: "all" }],
      ]),
    );
    expect((await getActiveAnnouncement({ isPro: false, isTester: false }))?.id).toBe("all-old");
    expect((await getActiveAnnouncement({ isPro: true, isTester: false }))?.id).toBe("pros");
    expect((await getActiveAnnouncement({ isPro: false, isTester: true }))?.id).toBe("testers");
    h.getDocs.mockResolvedValue(
      docs([
        ["n1", { audience: "all" }],
        ["t", { audience: "all", createdAt: ts(2) }],
        ["n2", { audience: "all" }],
      ]),
    );
    expect((await getActiveAnnouncement({ isPro: false, isTester: false }))?.id).toBe("t");
    h.getDocs.mockResolvedValue(docs([["p", { audience: "pros" }]]));
    expect(await getActiveAnnouncement({ isPro: false, isTester: false })).toBeNull();
  });
});

describe("dismissals", () => {
  it("remembers dismissed ids and survives bad storage", () => {
    expect(dismissedAnnouncements()).toEqual([]);
    dismissAnnouncement("a");
    expect(dismissedAnnouncements()).toEqual(["a"]);
    localStorage.setItem("skatehubba.dismissedAnnouncements", "{bad");
    expect(dismissedAnnouncements()).toEqual([]);
    localStorage.setItem("skatehubba.dismissedAnnouncements", '{"a":1}');
    expect(dismissedAnnouncements()).toEqual([]);
    localStorage.setItem("skatehubba.dismissedAnnouncements", '["x",2]');
    expect(dismissedAnnouncements()).toEqual(["x"]);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    expect(() => dismissAnnouncement("b")).not.toThrow();
    spy.mockRestore();
  });
});

describe("fetchAnalytics", () => {
  const snap = { dailyPlayers: 1, retention: { cohort: 0, returned: 0 } };
  it("calls the admin callable", async () => {
    h.callable.mockResolvedValue({ data: snap });
    expect(await fetchAnalytics()).toEqual(snap);
    expect(h.connect).not.toHaveBeenCalled();
    h.emulator = true;
    await fetchAnalytics();
    expect(h.connect).toHaveBeenCalled();
  });
  it("rejects bad responses and a missing app", async () => {
    h.callable.mockResolvedValue({ data: null });
    await expect(fetchAnalytics()).rejects.toThrow("bad response");
    h.callable.mockResolvedValue({ data: { dailyPlayers: 1 } });
    await expect(fetchAnalytics()).rejects.toThrow("bad response");
    h.callable.mockResolvedValue({ data: { dailyPlayers: "1", retention: {} } });
    await expect(fetchAnalytics()).rejects.toThrow("bad response");
    h.app = null;
    await expect(fetchAnalytics()).rejects.toThrow("not initialized");
  });
});
