import { describe, expect, it, vi } from "vitest";
import {
  isScreenable,
  rescreenPending,
  renderRescreenLog,
  stateOf,
  type PendingClip,
  type RescreenDeps,
  type RescreenOptions,
} from "./rescreen.js";

const NOW = Date.UTC(2026, 9, 22, 6, 0, 0);
const at = (minutesAgo: number) => ({ toMillis: () => NOW - minutesAgo * 60_000 });

function clip(id: string, minutesAgo: number, extra: Record<string, unknown> = {}): PendingClip {
  return {
    id,
    data: {
      source: "user",
      moderation: "pending",
      moderationStatus: "pending",
      playerUid: `uid-${id}`,
      playerUsername: `sk8_${id}`,
      createdAt: at(minutesAgo),
      ...extra,
    },
  };
}

const OPTIONS: RescreenOptions = { apply: true, limit: 25, delayMs: 0, minAgeMs: 10 * 60_000, maxErrors: 2 };

/** In-memory clips collection. `screen` behaves like the handler: pending-only write. */
function harness(
  initial: PendingClip[],
  screenResult: (id: string) => Record<string, unknown> = () => ({
    moderation: "approved",
    moderationStatus: "active",
  }),
) {
  const store = new Map(initial.map((c) => [c.id, { ...c.data }]));
  const writes: string[] = [];
  const deps: RescreenDeps = {
    listPending: vi.fn(async () =>
      [...store.entries()]
        .filter(([, d]) => d.moderation === "pending" || d.moderationStatus === "pending")
        .map(([id, data]) => ({ id, data: { ...data } })),
    ),
    read: vi.fn(async (id: string) => (store.has(id) ? { ...store.get(id) } : null)),
    ownerHandle: vi.fn(async (c: Record<string, unknown>) =>
      typeof c.playerUsername === "string" ? c.playerUsername : "",
    ),
    screen: vi.fn(async (id: string) => {
      const current = store.get(id);
      if (!current || current.moderation !== "pending") return "skipped" as const;
      const patch = screenResult(id);
      store.set(id, { ...current, ...patch });
      writes.push(id);
      return patch.moderation === "approved" ? ("approved" as const) : ("review" as const);
    }),
    sleep: vi.fn(async () => undefined),
    now: () => NOW,
  };
  return { deps, store, writes };
}

describe("selection", () => {
  it("screens only pending user uploads, oldest first", async () => {
    const { deps, writes } = harness([
      clip("new", 30),
      clip("old", 600),
      clip("game", 600, { source: "game" }),
      clip("statusOnly", 600, { moderation: undefined }),
    ]);
    const { rows } = await rescreenPending(deps, OPTIONS);
    expect(writes).toEqual(["old", "new"]);
    const byId = Object.fromEntries(rows.map((r) => [r.clipId, r]));
    expect(byId.game?.action).toBe("skipped-not-screenable");
    expect(byId.statusOnly?.action).toBe("skipped-not-screenable");
    expect(byId.statusOnly?.before).toBe("-/pending");
    expect(rows.map((r) => r.clipId)).toEqual(["game", "old", "statusOnly", "new"]);
  });

  it("leaves clips younger than the minimum age to the live trigger", async () => {
    const { deps, writes } = harness([clip("fresh", 3), clip("stale", 60)]);
    const { rows } = await rescreenPending(deps, OPTIONS);
    expect(writes).toEqual(["stale"]);
    expect(rows.find((r) => r.clipId === "fresh")?.action).toBe("skipped-too-new");
  });

  it("honours --limit and the batch delay", async () => {
    const { deps, writes } = harness([clip("a", 300), clip("b", 200), clip("c", 100)]);
    const { rows } = await rescreenPending(deps, { ...OPTIONS, limit: 2, delayMs: 4000 });
    expect(writes).toEqual(["a", "b"]);
    expect(rows.find((r) => r.clipId === "c")?.action).toBe("not-run-limit");
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(deps.sleep).toHaveBeenCalledWith(4000);
  });

  it("helpers agree with the handler's precondition", () => {
    expect(isScreenable({ source: "user", moderation: "pending" })).toBe(true);
    expect(isScreenable({ source: "user", moderation: "review" })).toBe(false);
    expect(isScreenable({ moderation: "pending" })).toBe(false);
    expect(isScreenable(null)).toBe(false);
    expect(stateOf(null)).toBe("deleted");
    expect(stateOf({})).toBe("-/-");
  });
});

describe("dry run", () => {
  it("reads only: no screen, no re-read, no sleep", async () => {
    const { deps, store } = harness([clip("a", 300), clip("b", 200)]);
    const before = JSON.stringify([...store.entries()]);
    const { rows } = await rescreenPending(deps, { ...OPTIONS, apply: false, delayMs: 5000 });
    expect(rows.map((r) => r.action)).toEqual(["would-screen", "would-screen"]);
    expect(rows[0]).toMatchObject({ owner: "sk8_a", ageMs: 300 * 60_000, before: "pending/pending" });
    expect(deps.screen).not.toHaveBeenCalled();
    expect(deps.read).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(JSON.stringify([...store.entries()])).toBe(before);
  });
});

describe("apply", () => {
  it("passes the fresh clip data to the shared handler and records before/after", async () => {
    const { deps } = harness([clip("a", 300)]);
    const { rows } = await rescreenPending(deps, OPTIONS);
    expect(deps.screen).toHaveBeenCalledWith("a", expect.objectContaining({ moderation: "pending", source: "user" }));
    expect(rows[0]).toMatchObject({
      action: "screened",
      before: "pending/pending",
      after: "approved/active",
      note: "outcome approved",
    });
  });

  it("logs a thrown handler error and keeps going", async () => {
    const { deps } = harness([clip("a", 300), clip("b", 200)]);
    vi.mocked(deps.screen).mockRejectedValueOnce(new Error("boom\nline"));
    const { rows, stopped } = await rescreenPending(deps, OPTIONS);
    expect(rows[0]).toMatchObject({ action: "error", note: "boom line", after: "pending/pending" });
    expect(rows[1]?.action).toBe("screened");
    expect(stopped).toBe(false);
  });

  it("stops after repeated screener errors so a bad IAM role cannot flood review", async () => {
    const { deps, writes } = harness([clip("a", 300), clip("b", 200), clip("c", 100)], () => ({
      moderation: "review",
      moderationStatus: "hidden",
      moderationScores: { error: "annotate 403" },
    }));
    const { rows, stopped } = await rescreenPending(deps, OPTIONS);
    expect(writes).toEqual(["a", "b"]);
    expect(stopped).toBe(true);
    expect(rows.map((r) => r.action)).toEqual(["error", "error", "not-run-stopped"]);
    expect(rows[0]?.note).toBe("screener error, sent to review: annotate 403");
  });

  it("a real review (no error) resets the error streak", async () => {
    const { deps } = harness([clip("a", 300)], () => ({ moderation: "review", moderationStatus: "hidden" }));
    const { rows } = await rescreenPending(deps, { ...OPTIONS, maxErrors: 1 });
    expect(rows[0]).toMatchObject({ action: "screened", note: "outcome review" });
  });
});

describe("idempotency", () => {
  it("skips a clip that an admin or the trigger decided after listing", async () => {
    const h = harness([clip("a", 300), clip("b", 200)]);
    const realRead = h.deps.read;
    h.deps.read = vi.fn(async (id: string) => {
      if (id === "b" && h.store.get("b")?.moderation === "pending") {
        h.store.set("b", { ...h.store.get("b"), moderation: "approved", moderationStatus: "active" });
      }
      return realRead(id);
    });
    const { rows } = await rescreenPending(h.deps, OPTIONS);
    expect(h.writes).toEqual(["a"]);
    expect(rows[1]).toMatchObject({ action: "skipped-changed", before: "approved/active", after: "approved/active" });
    expect(h.deps.screen).toHaveBeenCalledTimes(1);
  });

  it("records a handler guard refusal (decision landed between re-read and write)", async () => {
    const { deps } = harness([clip("a", 300)]);
    vi.mocked(deps.screen).mockResolvedValueOnce("skipped");
    const { rows } = await rescreenPending(deps, OPTIONS);
    expect(rows[0]?.action).toBe("skipped-changed");
  });

  it("does not claim a screen when an admin decided during Video Intelligence (outcome review, write refused)", async () => {
    const h = harness([clip("a", 300)]);
    h.deps.screen = vi.fn(async (id: string) => {
      h.store.set(id, { ...h.store.get(id), moderation: "approved", moderationStatus: "active" });
      return "review" as const;
    });
    const { rows } = await rescreenPending(h.deps, OPTIONS);
    expect(rows[0]).toMatchObject({ action: "skipped-changed", before: "pending/pending", after: "approved/active" });
  });

  it("skips a clip deleted after listing", async () => {
    const h = harness([clip("a", 300)]);
    h.deps.read = vi.fn(async () => null);
    const { rows } = await rescreenPending(h.deps, OPTIONS);
    expect(rows[0]).toMatchObject({ action: "skipped-deleted", after: "deleted" });
    expect(h.deps.screen).not.toHaveBeenCalled();
  });

  it("a second run finds nothing left to screen", async () => {
    const h = harness([clip("a", 300), clip("b", 200)]);
    await rescreenPending(h.deps, OPTIONS);
    const second = await rescreenPending(h.deps, OPTIONS);
    expect(second.rows).toEqual([]);
    expect(h.writes).toEqual(["a", "b"]);
  });
});

describe("log output", () => {
  const meta = {
    startedAt: "10/22/2026, 00:10:00 PT",
    finishedAt: "10/22/2026, 00:11:00 PT",
    apply: true,
    project: "demo-skatehubba",
    database: "skatehubba",
    options: OPTIONS,
  };

  it("renders one markdown row per clip with ids, handles, ages and states only", async () => {
    const { deps } = harness([
      clip("a", 3 * 24 * 60 + 90, { playerUsername: "pipe|name", email: "x@example.com" }),
      clip("b", 125),
      clip("c", 30, { playerUsername: "" }),
      clip("d", 0, { createdAt: undefined }),
    ]);
    const result = await rescreenPending(deps, { ...OPTIONS, minAgeMs: 0 });
    const md = renderRescreenLog(result, meta);
    expect(md).toContain("## Rescreen APPLY: 10/22/2026, 00:10:00 PT");
    expect(md).toContain("| Clip | Owner | Age | Before | After | Action | Note |");
    expect(md).toContain(
      "| a | @pipe\\|name | 3d 1h | pending/pending | approved/active | screened | outcome approved |",
    );
    expect(md).toContain("| b | @sk8_b | 2h 5m |");
    expect(md).toContain("| c | (unknown) | 30m |");
    expect(md).toContain("| d | @sk8_d | unknown |");
    expect(md).toContain("Listed 4. screened 4.");
    expect(md).not.toContain("x@example.com");
    expect(md).not.toContain("uid-");
  });

  it("says so when nothing is pending, and flags an early stop", () => {
    const empty = renderRescreenLog({ rows: [], stopped: false }, { ...meta, apply: false });
    expect(empty).toContain("## Rescreen DRY RUN");
    expect(empty).toContain("Listed 0. Nothing pending.");
    expect(empty).not.toContain("| Clip |");
    expect(renderRescreenLog({ rows: [], stopped: true }, meta)).toContain("Stopped early");
  });
});
