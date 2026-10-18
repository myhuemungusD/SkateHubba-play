import { describe, it, expect, vi } from "vitest";

vi.mock("firebase-admin/firestore", () => ({ FieldValue: { serverTimestamp: () => "TS" } }));
import { fanOutAnnouncement } from "./announce.js";

type Docs = Record<string, Record<string, unknown> | undefined>;
function fakeDb(docs: Docs) {
  const sets: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  let commits = 0;
  let auto = 0;
  const docRef = (c: string, id: string) => ({
    path: `${c}/${id}`,
    get: async () => ({ data: () => docs[`${c}/${id}`] }),
    update: async (u: Record<string, unknown>) => updates.push(u),
  });
  const list = (c: string, where?: [string, unknown]) =>
    Object.entries(docs)
      .filter(([k, v]) => k.startsWith(`${c}/`) && (!where || v?.[where[0]] === where[1]))
      .map(([k, v]) => ({ id: k.slice(c.length + 1), data: () => v }));
  const db = {
    collection: (c: string) => ({
      doc: (id?: string) => docRef(c, id ?? `auto${auto++}`),
      limit: () => ({ get: async () => ({ docs: list(c) }) }),
      where: (f: string, _op: string, v: unknown) => ({
        limit: () => ({ get: async () => ({ docs: list(c, [f, v]) }) }),
      }),
    }),
    runTransaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        get: async (ref: { path: string }) => ({ data: () => docs[ref.path] }),
        update: (_r: unknown, u: Record<string, unknown>) => updates.push(u),
      }),
    batch: () => ({
      set: (_r: unknown, d: Record<string, unknown>) => sets.push(d),
      commit: async () => {
        commits++;
      },
    }),
  };
  return { db: db as never, sets, updates, commits: () => commits };
}
const ann = (audience: string, push = true) => ({
  title: "Hi",
  body: "Jam Saturday",
  audience,
  push,
  createdBy: "adm",
});

describe("fanOutAnnouncement", () => {
  it("skips banner-only and malformed announcements", async () => {
    const { db } = fakeDb({});
    expect(await fanOutAnnouncement(db, "a", ann("all", false))).toEqual({ queued: 0, reason: "no_push" });
    expect(await fanOutAnnouncement(db, "a", undefined)).toMatchObject({ reason: "no_push" });
    expect(await fanOutAnnouncement(db, "a", { ...ann("all"), audience: "x" })).toMatchObject({ reason: "malformed" });
    expect(await fanOutAnnouncement(db, "a", { ...ann("all"), title: 5 })).toMatchObject({ reason: "malformed" });
  });
  it("never sends twice", async () => {
    const { db, sets } = fakeDb({ "announcements/a": { pushStatus: "sent" }, "pushTargets/u": { tokens: ["t"] } });
    expect(await fanOutAnnouncement(db, "a", ann("all"))).toEqual({ queued: 0, reason: "already_sent" });
    expect(sets).toHaveLength(0);
  });
  it("queues one dispatch per user with tokens for everyone", async () => {
    const { db, sets, updates } = fakeDb({
      "announcements/a": {},
      "pushTargets/u1": { tokens: ["t1", 3, ""] },
      "pushTargets/u2": { tokens: [] },
      "pushTargets/u3": {},
    });
    expect(await fanOutAnnouncement(db, "a", ann("all"))).toEqual({ queued: 1 });
    expect(sets[0]).toMatchObject({ tokens: ["t1"], recipientUid: "u1", notification: { title: "Hi" } });
    expect(updates.at(-1)).toMatchObject({ pushStatus: "sent", pushCount: 1 });
  });
  it("targets testers or pros", async () => {
    const base = { "announcements/a": {}, "pushTargets/t": { tokens: ["x"] }, "pushTargets/p": { tokens: ["y"] } };
    const testers = fakeDb({ ...base, "config/featureTesters": { uids: ["t", 7] } });
    expect(await fanOutAnnouncement(testers.db, "a", ann("testers"))).toEqual({ queued: 1 });
    expect(testers.sets[0]).toMatchObject({ recipientUid: "t" });
    expect(await fanOutAnnouncement(fakeDb(base).db, "a", ann("testers"))).toEqual({ queued: 0 });
    const pros = fakeDb({ ...base, "users/p": { isVerifiedPro: true }, "users/q": {} });
    expect(await fanOutAnnouncement(pros.db, "a", ann("pros"))).toEqual({ queued: 1 });
    expect(pros.sets[0]).toMatchObject({ recipientUid: "p" });
  });
  it("commits in batches of 400", async () => {
    const docs: Docs = { "announcements/a": {} };
    for (let i = 0; i < 401; i++) docs[`pushTargets/u${i}`] = { tokens: ["t"] };
    const f = fakeDb(docs);
    expect(await fanOutAnnouncement(f.db, "a", ann("all"))).toEqual({ queued: 401 });
    expect(f.commits()).toBe(2);
  });
});
