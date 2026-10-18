import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  addDoc: vi.fn(),
  getDocs: vi.fn(),
  uid: { v: "a1" as string | null },
  throwAuth: { v: false },
}));
vi.mock("firebase/firestore", () => ({
  collection: (_db: unknown, ...p: string[]) => p.join("/"),
  orderBy: (...a: unknown[]) => ({ orderBy: a }),
  limit: (n: number) => ({ limit: n }),
  query: (...a: unknown[]) => a,
  serverTimestamp: () => "TS",
  addDoc: h.addDoc,
  getDocs: h.getDocs,
}));
vi.mock("../../firebase", () => ({
  requireDb: () => ({}),
  requireAuth: () => {
    if (h.throwAuth.v) throw new Error("no auth");
    return { currentUser: h.uid.v ? { uid: h.uid.v } : null };
  },
}));

import { listAdminAudit, recordAdminAction } from "../admin.audit";

beforeEach(() => {
  vi.clearAllMocks();
  h.uid.v = "a1";
  h.throwAuth.v = false;
  h.addDoc.mockResolvedValue({});
});
afterEach(() => vi.unstubAllEnvs());

describe("recordAdminAction", () => {
  it("does nothing while the flag is off", () => {
    recordAdminAction("ban", "u1");
    expect(h.addDoc).not.toHaveBeenCalled();
  });
  it("writes a capped entry when on", () => {
    vi.stubEnv("VITE_FEATURE_ADMIN_OPS", "true");
    recordAdminAction("ban", "u".repeat(200), "r".repeat(400));
    const [path, data] = h.addDoc.mock.calls[0];
    expect(path).toBe("adminAudit");
    expect(data).toMatchObject({ adminUid: "a1", action: "ban", at: "TS" });
    expect(data.targetId).toHaveLength(128);
    expect(data.detail).toHaveLength(300);
    recordAdminAction("unban", "u2");
    expect(h.addDoc.mock.calls[1][1].detail).toBe("");
  });
  it("skips without a signed-in admin and swallows failures", async () => {
    vi.stubEnv("VITE_FEATURE_ADMIN_OPS", "true");
    h.uid.v = null;
    recordAdminAction("ban", "u1");
    expect(h.addDoc).not.toHaveBeenCalled();
    h.uid.v = "a1";
    h.addDoc.mockRejectedValueOnce(new Error("denied"));
    expect(() => recordAdminAction("ban", "u1")).not.toThrow();
    await Promise.resolve();
    h.throwAuth.v = true;
    expect(() => recordAdminAction("ban", "u1")).not.toThrow();
  });
});

describe("listAdminAudit", () => {
  it("maps entries and tolerates bad fields", async () => {
    h.getDocs.mockResolvedValue({
      docs: [
        {
          id: "e1",
          data: () => ({ adminUid: "a", action: "ban", targetId: "u", detail: "d", at: { toMillis: () => 7 } }),
        },
        { id: "e2", data: () => ({ adminUid: 1, action: null, targetId: 2, detail: 3 }) },
      ],
    });
    expect(await listAdminAudit()).toEqual([
      { id: "e1", adminUid: "a", action: "ban", targetId: "u", detail: "d", atMs: 7 },
      { id: "e2", adminUid: "", action: "", targetId: "", detail: "", atMs: null },
    ]);
  });
});
