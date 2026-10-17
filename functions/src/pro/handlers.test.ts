import { describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { BlessingError, blessSkater, respondToBlessing, revokePro } from "./handlers.js";
import { DAY_MS, DEFAULT_BLESSING_CONFIG as CFG, cleanReason, toMillis } from "./rules.js";
import type { DiceDb, DiceDoc, DiceQuery, DiceTx } from "../dice/store.js";

vi.mock("firebase-functions/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const NOW = 1_800_000_000_000;
const OLD = Timestamp.fromMillis(NOW - 90 * DAY_MS);
const REASON = "Rips every ledge in town, real deal.";

class Mem implements DiceDb {
  docs = new Map<string, Record<string, unknown>>();
  private seq = 0;
  async get(path: string): Promise<DiceDoc> {
    const data = this.docs.get(path);
    return { id: path.split("/").pop() ?? path, data: data ? { ...data } : undefined };
  }
  async query(q: DiceQuery): Promise<DiceDoc[]> {
    const out: DiceDoc[] = [];
    for (const [path, data] of this.docs) {
      const rest = path.slice(q.collection.length + 1);
      if (!path.startsWith(`${q.collection}/`) || rest.includes("/")) continue;
      if (q.filters.every((f) => data[f.field] === f.value)) out.push({ id: rest, data: { ...data } });
    }
    return out;
  }
  async add(): Promise<void> {}
  newId(): string {
    this.seq += 1;
    return `b${this.seq}`;
  }
  async runTransaction<T>(fn: (tx: DiceTx) => Promise<T>): Promise<T> {
    let wrote = false;
    const guard = () => {
      if (wrote) throw new Error("read after write");
    };
    const tx: DiceTx = {
      get: (p) => (guard(), this.get(p)),
      query: (q) => (guard(), this.query(q)),
      set: (p, d) => {
        wrote = true;
        this.docs.set(p, { ...d });
      },
      update: (p, d) => {
        wrote = true;
        const prev = this.docs.get(p);
        if (!prev) throw new Error(`missing ${p}`);
        this.docs.set(p, { ...prev, ...d });
      },
    };
    return fn(tx);
  }
}

function world(): Mem {
  const db = new Mem();
  db.docs.set("users/pro", { username: "bryanherman", isVerifiedPro: true, createdAt: OLD });
  db.docs.set("users/sk8", { username: "rookie", createdAt: OLD });
  return db;
}
const me = (uid: string, nowMs = NOW) => ({ uid, nowMs, emailVerified: true });

async function code(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(BlessingError);
    return (err as BlessingError).code;
  }
  throw new Error("expected failure");
}

describe("blessSkater", () => {
  it("creates a pending blessing and notifies the skater, without touching pro fields", async () => {
    const db = world();
    const res = await blessSkater(db, me("pro"), "sk8", REASON, CFG);
    expect(res).toEqual({ blessingId: "b1", status: "pending" });
    expect(db.docs.get("proBlessings/b1")).toMatchObject({
      blesserUid: "pro",
      blesserUsername: "bryanherman",
      targetUid: "sk8",
      reason: REASON,
      status: "pending",
    });
    expect(db.docs.get("notifications/pro_blessing_b1")).toMatchObject({ recipientUid: "sk8", type: "pro_blessing" });
    expect(db.docs.get("users/sk8")?.isVerifiedPro).toBeUndefined();
  });

  it.each([
    [
      "non-pro caller",
      (db: Mem) => db.docs.set("users/sk8", { username: "x", createdAt: OLD }),
      "sk8",
      "pro",
      "not_a_pro",
    ],
    [
      "banned pro",
      (db: Mem) => db.docs.set("users/pro", { isVerifiedPro: true, banned: true }),
      "pro",
      "sk8",
      "not_a_pro",
    ],
  ])("rejects %s", async (_name, mutate, caller, target, expected) => {
    const db = world();
    mutate(db);
    expect(await code(() => blessSkater(db, me(caller), target, REASON, CFG))).toBe(expected);
  });

  it("rejects self, already-pro, banned, missing, new, and blocked targets", async () => {
    const db = world();
    expect(await code(() => blessSkater(db, me("pro"), "pro", REASON, CFG))).toBe("self_blessing");
    db.docs.set("users/p2", { isVerifiedPro: true, createdAt: OLD });
    expect(await code(() => blessSkater(db, me("pro"), "p2", REASON, CFG))).toBe("already_pro");
    db.docs.set("users/bad", { banned: true, createdAt: OLD });
    expect(await code(() => blessSkater(db, me("pro"), "bad", REASON, CFG))).toBe("not_eligible");
    expect(await code(() => blessSkater(db, me("pro"), "ghost", REASON, CFG))).toBe("not_found");
    db.docs.set("users/new", { createdAt: Timestamp.fromMillis(NOW - DAY_MS) });
    expect(await code(() => blessSkater(db, me("pro"), "new", REASON, CFG))).toBe("account_too_new");
    db.docs.set("users/sk8/blocked_users/pro", { blockedAt: 1 });
    expect(await code(() => blessSkater(db, me("pro"), "sk8", REASON, CFG))).toBe("not_eligible");
  });

  it("requires a verified email and a real reason", async () => {
    const db = world();
    expect(await code(() => blessSkater(db, { ...me("pro"), emailVerified: false }, "sk8", REASON, CFG))).toBe(
      "email_unverified",
    );
    expect(await code(() => blessSkater(db, me("pro"), "sk8", "  short ", CFG))).toBe("bad_reason");
    expect(await code(() => blessSkater(db, me("pro"), "sk8", "x".repeat(281), CFG))).toBe("bad_reason");
  });

  it("blocks a second open offer but replaces an expired one", async () => {
    const db = world();
    await blessSkater(db, me("pro"), "sk8", REASON, CFG);
    db.docs.set("users/pro2", { username: "mikewhite", isVerifiedPro: true });
    expect(await code(() => blessSkater(db, me("pro2"), "sk8", REASON, CFG))).toBe("already_offered");
    const later = NOW + 15 * DAY_MS;
    await blessSkater(db, me("pro2", later), "sk8", REASON, CFG);
    expect(db.docs.get("proBlessings/b1")?.status).toBe("expired");
  });

  it("enforces the per-pro rate limit inside the window, declines included", async () => {
    const db = world();
    for (const uid of ["a", "b", "c"]) db.docs.set(`users/${uid}`, { createdAt: OLD });
    await blessSkater(db, me("pro"), "a", REASON, CFG);
    await respondToBlessing(db, me("a"), "b1", false, CFG);
    await blessSkater(db, me("pro"), "b", REASON, CFG);
    expect(await code(() => blessSkater(db, me("pro"), "c", REASON, CFG))).toBe("limit_reached");
    await blessSkater(db, me("pro", NOW + 31 * DAY_MS), "c", REASON, CFG);
  });
});

describe("respondToBlessing", () => {
  it("accept turns the skater pro with lineage and notifies the blesser", async () => {
    const db = world();
    await blessSkater(db, me("pro"), "sk8", REASON, CFG);
    expect(await respondToBlessing(db, me("sk8"), "b1", true, CFG)).toEqual({ blessingId: "b1", status: "accepted" });
    const user = db.docs.get("users/sk8");
    expect(user).toMatchObject({ isVerifiedPro: true, verifiedBy: "pro" });
    expect(toMillis(user?.verifiedAt)).toBe(NOW);
    expect(db.docs.get("proBlessings/b1")?.status).toBe("accepted");
    expect(db.docs.get("notifications/pro_blessing_accepted_b1")).toMatchObject({ recipientUid: "pro" });
  });

  it("decline records it and grants nothing", async () => {
    const db = world();
    await blessSkater(db, me("pro"), "sk8", REASON, CFG);
    await respondToBlessing(db, me("sk8"), "b1", false, CFG);
    expect(db.docs.get("proBlessings/b1")?.status).toBe("declined");
    expect(db.docs.get("users/sk8")?.isVerifiedPro).toBeUndefined();
  });

  it("only the blessed skater can answer, once, before it lapses, while the blesser is still pro", async () => {
    const db = world();
    await blessSkater(db, me("pro"), "sk8", REASON, CFG);
    expect(await code(() => respondToBlessing(db, me("pro"), "b1", true, CFG))).toBe("not_yours");
    expect(await code(() => respondToBlessing(db, me("sk8"), "nope", true, CFG))).toBe("not_found");
    db.docs.set("users/pro", { isVerifiedPro: false });
    expect(await code(() => respondToBlessing(db, me("sk8"), "b1", true, CFG))).toBe("blesser_not_pro");
    expect((await respondToBlessing(db, me("sk8", NOW + 15 * DAY_MS), "b1", true, CFG)).status).toBe("expired");
    expect(await code(() => respondToBlessing(db, me("sk8"), "b1", true, CFG))).toBe("not_pending");
  });
});

describe("revokePro", () => {
  it("clears pro, keeps the record and stamps the admin", async () => {
    const db = world();
    await blessSkater(db, me("pro"), "sk8", REASON, CFG);
    await respondToBlessing(db, me("sk8"), "b1", true, CFG);
    await revokePro(db, me("admin"), "sk8", "Impersonation confirmed by founder.");
    expect(db.docs.get("users/sk8")).toMatchObject({ isVerifiedPro: false, verifiedBy: "admin" });
    expect(db.docs.get("proBlessings/b1")).toMatchObject({ status: "revoked", revokedBy: "admin", blesserUid: "pro" });
    expect(await code(() => revokePro(db, me("admin"), "sk8", "Impersonation confirmed."))).toBe("not_a_pro");
    expect(await code(() => revokePro(db, me("admin"), "pro", "no"))).toBe("bad_reason");
  });
});

describe("rules helpers", () => {
  it("normalises reasons and timestamps", () => {
    expect(cleanReason("  a  b  c  d e f g ")).toBe("a b c d e f g");
    expect(cleanReason(5)).toBeNull();
    expect(toMillis(new Date(5))).toBe(5);
    expect(toMillis("x")).toBeNull();
  });
});
