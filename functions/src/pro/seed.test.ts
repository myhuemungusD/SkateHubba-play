import { describe, expect, it, vi } from "vitest";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { handleProSeedCall, seedPro } from "./seed.js";
import { parseSeedInput, SeedInputError } from "./seedInput.js";
import type { DiceDb, DiceDoc, DiceTx } from "../dice/store.js";

vi.mock("firebase-functions/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const NOW = 1_800_000_000_000;
const ADMIN = "admin1";
const VALID = {
  targetUid: "sk8",
  reason: "Pro for Baker since 2019, two video parts.",
  evidence: { company: "Baker Skateboards", url: "https://bakerskateboards.com/team/sk8" },
};

class Mem implements DiceDb {
  docs = new Map<string, Record<string, unknown>>();
  failTx: Error | null = null;
  async get(path: string): Promise<DiceDoc> {
    const data = this.docs.get(path);
    return { id: path.split("/").pop() ?? path, data: data ? { ...data } : undefined };
  }
  async query(): Promise<DiceDoc[]> {
    return [];
  }
  async add(): Promise<void> {}
  newId(): string {
    return "audit1";
  }
  async runTransaction<T>(fn: (tx: DiceTx) => Promise<T>): Promise<T> {
    if (this.failTx) throw this.failTx;
    const staged: (() => void)[] = [];
    const tx: DiceTx = {
      get: (p) => this.get(p),
      query: () => this.query(),
      set: (p, d) => void staged.push(() => this.docs.set(p, { ...d })),
      update: (p, d) =>
        void staged.push(() => {
          const prev = this.docs.get(p);
          if (!prev) throw new Error(`missing ${p}`);
          this.docs.set(p, { ...prev, ...d });
        }),
    };
    const out = await fn(tx);
    staged.forEach((apply) => apply());
    return out;
  }
}

function world(target: Record<string, unknown> = { username: "rookie" }): Mem {
  const db = new Mem();
  db.docs.set("users/sk8", target);
  return db;
}

const req = (data: unknown, opts: { admin?: unknown; uid?: string | null; app?: boolean } = {}) =>
  ({
    auth: opts.uid === null ? undefined : { uid: opts.uid ?? ADMIN, token: { admin: "admin" in opts ? opts.admin : true } },
    app: opts.app === false ? undefined : { appId: "web" },
    data,
  }) as unknown as CallableRequest;

async function code(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(HttpsError);
    return `${(err as HttpsError).code}:${(err as HttpsError).message}`;
  }
  throw new Error("expected failure");
}

describe("proSeed callable", () => {
  it("seeds the badge and writes the audit row in one transaction", async () => {
    const db = world();
    const res = await handleProSeedCall(req(VALID), { db, nowMs: NOW });
    expect(res).toEqual({ auditId: "audit1", status: "seeded" });
    expect(db.docs.get("users/sk8")).toMatchObject({ isVerifiedPro: true, verifiedBy: ADMIN });
    expect(db.docs.get("proAudit/audit1")).toMatchObject({
      action: "seed",
      actorUid: ADMIN,
      targetUid: "sk8",
      targetUsername: "rookie",
      reason: VALID.reason,
      evidenceCompany: "Baker Skateboards",
      evidenceUrl: VALID.evidence.url,
      source: "callable",
    });
  });

  it("rejects signed-out callers", async () => {
    expect(await code(() => handleProSeedCall(req(VALID, { uid: null }), { db: world(), nowMs: NOW }))).toBe(
      "unauthenticated:unauthenticated",
    );
  });

  it.each([[false], [undefined], ["true"], [1]])("rejects a non-admin token (admin=%s)", async (admin) => {
    const db = world();
    expect(await code(() => handleProSeedCall(req(VALID, { admin }), { db, nowMs: NOW }))).toBe(
      "permission-denied:not_admin",
    );
    expect(db.docs.get("users/sk8")?.isVerifiedPro).toBeUndefined();
  });

  it("a verified pro without the admin claim cannot seed", async () => {
    const db = world();
    db.docs.set("users/pro", { isVerifiedPro: true });
    expect(await code(() => handleProSeedCall(req(VALID, { uid: "pro", admin: undefined }), { db, nowMs: NOW }))).toBe(
      "permission-denied:not_admin",
    );
  });

  it("requires an App Check token", async () => {
    expect(await code(() => handleProSeedCall(req(VALID, { app: false }), { db: world(), nowMs: NOW }))).toBe(
      "failed-precondition:app_check_required",
    );
  });

  it.each([
    [{ ...VALID, reason: "short" }, "bad_reason"],
    [{ ...VALID, reason: undefined }, "bad_reason"],
    [{ ...VALID, evidence: undefined }, "bad_evidence_company"],
    [{ ...VALID, evidence: { ...VALID.evidence, company: " " } }, "bad_evidence_company"],
    [{ ...VALID, evidence: { ...VALID.evidence, url: "http://baker.com/x" } }, "bad_evidence_url"],
    [{ ...VALID, evidence: { ...VALID.evidence, url: "javascript:alert(1)" } }, "bad_evidence_url"],
    [{ ...VALID, evidence: { ...VALID.evidence, url: "not a url" } }, "bad_evidence_url"],
    [{ ...VALID, evidence: { ...VALID.evidence, url: "https://localhost/x" } }, "bad_evidence_url"],
    [{ ...VALID, evidence: { ...VALID.evidence, url: 7 } }, "bad_evidence_url"],
    [{ ...VALID, targetUid: "a/b" }, "bad_request"],
    [null, "bad_request"],
  ])("rejects bad input %#", async (data, expected) => {
    const db = world();
    expect(await code(() => handleProSeedCall(req(data), { db, nowMs: NOW }))).toBe(`invalid-argument:${expected}`);
    expect(db.docs.has("proAudit/audit1")).toBe(false);
  });

  it.each([
    [{ username: "rookie", isVerifiedPro: true }, "failed-precondition:already_pro"],
    [{ username: "rookie", banned: true }, "failed-precondition:target_banned"],
  ])("refuses an ineligible target %#", async (target, expected) => {
    const db = world(target);
    expect(await code(() => handleProSeedCall(req(VALID), { db, nowMs: NOW }))).toBe(expected);
    expect(db.docs.has("proAudit/audit1")).toBe(false);
  });

  it("refuses a missing target", async () => {
    const db = new Mem();
    expect(await code(() => handleProSeedCall(req(VALID), { db, nowMs: NOW }))).toBe("not-found:not_found");
  });

  it("an admin cannot seed themselves", async () => {
    expect(await code(() => handleProSeedCall(req({ ...VALID, targetUid: ADMIN }), { db: world(), nowMs: NOW }))).toBe(
      "permission-denied:self_seed",
    );
  });

  it("maps unexpected failures to internal", async () => {
    const db = world();
    db.failTx = new Error("boom");
    expect(await code(() => handleProSeedCall(req(VALID), { db, nowMs: NOW }))).toBe("internal:seed_failed");
    db.failTx = "x" as unknown as Error;
    expect(await code(() => handleProSeedCall(req(VALID), { db, nowMs: NOW }))).toBe("internal:seed_failed");
  });
});

describe("seedPro / parseSeedInput", () => {
  it("records the CLI as the source and tolerates a nameless profile", async () => {
    const db = world({});
    await seedPro(db, ADMIN, parseSeedInput(VALID), NOW, "cli");
    expect(db.docs.get("proAudit/audit1")).toMatchObject({ source: "cli", targetUsername: "" });
  });

  it("normalizes whitespace and the URL", () => {
    const out = parseSeedInput({
      ...VALID,
      reason: "  Pro   for Baker since 2019  ",
      evidence: { company: " Baker ", url: " https://Baker.com/team " },
    });
    expect(out).toMatchObject({
      reason: "Pro for Baker since 2019",
      evidenceCompany: "Baker",
      evidenceUrl: "https://baker.com/team",
    });
  });

  it("throws SeedInputError with a code", () => {
    expect(() => parseSeedInput({})).toThrow(SeedInputError);
  });
});
