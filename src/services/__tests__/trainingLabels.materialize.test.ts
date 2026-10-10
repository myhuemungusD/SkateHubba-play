import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyTrainingLabelPending,
  materializeTrainingLabels,
  type TrainingLabelDb,
} from "../trainingLabels.materialize";

interface Stored {
  data: Record<string, unknown> | undefined;
  exists: boolean;
  /** Query filters still see `data`, but `data()` returns undefined. */
  hideData?: boolean;
}

class Mem {
  store = new Map<string, Stored>();
  throws = new Set<string>();
  throwValue = new Map<string, unknown>();
  sets: string[] = [];
  updates: Array<{ key: string; data: Record<string, unknown> }> = [];
  deletes: string[] = [];

  put(
    collection: string,
    id: string,
    data: Record<string, unknown> | undefined,
    exists = true,
    hideData = false,
  ): void {
    this.store.set(`${collection}/${id}`, { data, exists, hideData });
  }

  ref(name: string, id: string) {
    const key = `${name}/${id}`;
    return {
      get: async () => {
        if (this.throws.has(`get:${key}`)) throw this.throwValue.get(`get:${key}`) ?? new Error(`get ${key}`);
        const stored = this.store.get(key);
        if (!stored) return { id, exists: false, data: () => undefined, ref: this.ref(name, id) };
        return {
          id,
          exists: stored.exists,
          data: () => (stored.hideData ? undefined : stored.data),
          ref: this.ref(name, id),
        };
      },
      set: async (data: Record<string, unknown>) => {
        this.sets.push(key);
        this.store.set(key, { data, exists: true });
      },
      update: async (data: Record<string, unknown>) => {
        this.updates.push({ key, data });
        const prev = this.store.get(key);
        this.store.set(key, { data: { ...(prev?.data ?? {}), ...data }, exists: true });
      },
      delete: async () => {
        this.deletes.push(key);
        this.store.delete(key);
      },
    };
  }

  collection(name: string): ReturnType<TrainingLabelDb["collection"]> {
    const build = (filters: Array<[string, unknown]>, limit: number): ReturnType<TrainingLabelDb["collection"]> => ({
      where: (field: string, _op: "==", value: unknown) => build([...filters, [field, value]], limit),
      limit: (n: number) => build(filters, n),
      get: async () => {
        if (this.throws.has(`query:${name}`))
          throw this.throwValue.get(`query:${name}`) ?? new Error(`${name} query failed`);
        const prefix = `${name}/`;
        const docs = [];
        for (const [key, stored] of this.store) {
          if (!key.startsWith(prefix) || !stored.exists) continue;
          const id = key.slice(prefix.length);
          const data = stored.data ?? {};
          if (filters.some(([field, value]) => data[field] !== value)) continue;
          docs.push({
            id,
            exists: stored.exists,
            data: () => (stored.hideData ? undefined : stored.data),
            ref: this.ref(name, id),
          });
          if (docs.length >= limit) break;
        }
        return { docs };
      },
      doc: (id: string) => this.ref(name, id),
    });
    return build([], Number.POSITIVE_INFINITY);
  }
}

function game(history: unknown, extra: Record<string, unknown> = {}) {
  return {
    trainingLabelPending: true,
    status: "complete",
    turnHistory: history,
    ...extra,
  };
}

const turn = {
  turnNumber: 1,
  trickId: "kickflip",
  stance: "regular",
  setterUid: "setter",
  matcherUid: "matcher",
  setVideoUrl: "https://cdn.example/set.webm",
  matchVideoUrl: "https://cdn.example/match.mp4",
  landed: true,
};

let mem: Mem;

beforeEach(() => {
  mem = new Mem();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("materializeTrainingLabels", () => {
  it("writes labels from consent, skips ones that already exist, and clears the flag", async () => {
    const now = new Date("2026-10-10T00:00:00.000Z");
    mem.put(
      "games",
      "g1",
      game([
        turn,
        null,
        { nope: true },
        { setterUid: "a", matcherUid: 1, turnNumber: 1 },
        { setterUid: "a", matcherUid: "b" },
        "bad",
        { ...turn, turnNumber: 2, trickId: "" },
      ]),
    );
    mem.put("users", "setter/private/profile", {
      trainingConsentOptedIn: true,
      trainingConsentPolicyVersion: "2026-10-10",
      trainingConsentUpdatedAt: 9,
    });
    mem.put("users", "matcher/private/profile", undefined, false);
    mem.put("trainingLabels", "g1_1_set", { id: "already" });
    mem.put("games", "ghost", undefined, true);

    const summary = await materializeTrainingLabels(mem, { dryRun: false, now });

    expect(summary).toMatchObject({ games: 1, labels: 1, errors: 0 });
    expect(mem.sets).toEqual(["trainingLabels/g1_1_match"]);
    const written = mem.store.get("trainingLabels/g1_1_match")?.data;
    expect(written).toMatchObject({
      ownerUid: "matcher",
      excluded: true,
      createdAt: now,
    });
    expect(written).not.toHaveProperty("id");
    expect(mem.updates).toContainEqual({ key: "games/g1", data: { trainingLabelPending: false } });
  });

  it("reuses a cached consent and counts a dry run without writing", async () => {
    mem.put("games", "g1", game([turn, { ...turn, turnNumber: 2 }]));
    mem.put(
      "users",
      "setter/private/profile",
      { trainingConsentOptedIn: true, trainingConsentPolicyVersion: "v" },
      true,
      true,
    );
    mem.put("users", "matcher/private/profile", { trainingConsentOptedIn: false });

    const summary = await materializeTrainingLabels(mem, { dryRun: true, now: new Date() });
    expect(summary.labels).toBe(4);
    expect(mem.sets).toEqual([]);
    expect(mem.updates).toEqual([]);
  });

  it("counts a failed pending query and does not touch revocations", async () => {
    mem.throws.add("query:games");
    mem.put("trainingRevocations", "u1", { revokedAt: 1 });
    const summary = await materializeTrainingLabels(mem, { dryRun: false });
    expect(summary.errors).toBe(1);
    expect(mem.deletes).toEqual([]);
  });

  it("isolates a bad game and still clears a game with no history array", async () => {
    mem.put("games", "bad", game([turn]));
    mem.put("games", "empty", game("nope"), true, true);
    mem.throws.add("get:trainingLabels/bad_1_set");
    const summary = await materializeTrainingLabels(mem, { dryRun: false, now: new Date() });
    expect(summary.errors).toBe(1);
    expect(summary.games).toBe(2);
    expect(mem.updates.some((update) => update.key === "games/empty")).toBe(true);
    expect(mem.updates.some((update) => update.key === "games/bad")).toBe(false);
  });

  it("excludes labels taken before a withdrawal and drops the revocation", async () => {
    const now = new Date("2026-10-10T12:00:00.000Z");
    mem.put("trainingRevocations", "u1", { revokedAt: { toMillis: () => 100 } });
    mem.put("trainingRevocations", "blank", {});
    mem.put("trainingRevocations", "nodata", undefined, true);
    mem.put("trainingLabels", "old", { ownerUid: "u1", excluded: false, createdAt: 50 });
    mem.put("trainingLabels", "new", { ownerUid: "u1", excluded: false, createdAt: 200 });
    mem.put("trainingLabels", "done", { ownerUid: "u1", excluded: true, createdAt: 10 });
    mem.put("trainingLabels", "missing", { ownerUid: "u1", excluded: false }, true, true);

    const summary = await materializeTrainingLabels(mem, { dryRun: false, now });
    expect(summary.excluded).toBe(2);
    expect(mem.store.get("trainingLabels/old")?.data).toMatchObject({
      excluded: true,
      exclusionReason: "consent_withdrawn",
      excludedAt: now,
    });
    expect(mem.store.get("trainingLabels/new")?.data?.excluded).toBe(false);
    expect(mem.deletes).toEqual(
      expect.arrayContaining(["trainingRevocations/u1", "trainingRevocations/blank", "trainingRevocations/nodata"]),
    );
  });

  it("counts a dry-run exclusion and a revocation that throws", async () => {
    mem.put("trainingRevocations", "u1", { revokedAt: 20 });
    mem.put("trainingRevocations", "blank", {});
    mem.put("trainingLabels", "old", { ownerUid: "u1", excluded: false, createdAt: new Date(10) });
    const dry = await materializeTrainingLabels(mem, { dryRun: true, now: new Date() });
    expect(dry.excluded).toBe(1);
    expect(mem.updates).toEqual([]);
    expect(mem.deletes).toEqual([]);

    mem.throws.add("query:trainingRevocations");
    mem.throwValue.set("query:trainingRevocations", "down");
    const failed = await materializeTrainingLabels(mem, { dryRun: false, now: new Date() });
    expect(failed.errors).toBe(1);
  });

  it("isolates one revocation failure", async () => {
    mem.put("trainingRevocations", "u1", { revokedAt: 20 });
    mem.throws.add("query:trainingLabels");
    const summary = await materializeTrainingLabels(mem, { dryRun: false, now: new Date() });
    expect(summary.errors).toBe(1);
    expect(mem.deletes).toEqual([]);
  });
});

describe("applyTrainingLabelPending", () => {
  it("raises the flag only for a catalog turn", () => {
    const out: Record<string, unknown> = {};
    applyTrainingLabelPending(out, undefined);
    expect(out).toEqual({});
    applyTrainingLabelPending(out, { trickId: "" });
    expect(out).toEqual({});
    applyTrainingLabelPending(out, { trickId: "kickflip" });
    expect(out).toEqual({ trainingLabelPending: true });
  });
});
