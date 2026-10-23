import { describe, expect, it, vi } from "vitest";
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { handleProSeedCall } from "./seed.js";
import { adminClaimLookup, seedPro } from "./seedCore.js";
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

const notAdmin = async () => false;
const deps = (db: Mem, isAdmin: (uid: string) => Promise<boolean> = notAdmin) => ({ db, nowMs: NOW, isAdmin });

function world(target: Record<string, unknown> = { username: "rookie" }): Mem {
  const db = new Mem();
  db.docs.set("users/sk8", target);
  return db;
}

const req = (data: unknown, opts: { admin?: unknown; uid?: string | null; app?: boolean } = {}) =>
  ({
    auth:
      opts.uid === null ? undefined : { uid: opts.uid ?? ADMIN, token: { admin: "admin" in opts ? opts.admin : true } },
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
    const res = await handleProSeedCall(req(VALID), deps(db));
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
    expect(await code(() => handleProSeedCall(req(VALID, { uid: null }), deps(world())))).toBe(
      "unauthenticated:unauthenticated",
    );
  });

  it.each([[false], [undefined], ["true"], [1]])("rejects a non-admin token (admin=%s)", async (admin) => {
    const db = world();
    expect(await code(() => handleProSeedCall(req(VALID, { admin }), deps(db)))).toBe(
      "permission-denied:not_admin",
    );
    expect(db.docs.get("users/sk8")?.isVerifiedPro).toBeUndefined();
  });

  it("a verified pro without the admin claim cannot seed", async () => {
    const db = world();
    db.docs.set("users/pro", { isVerifiedPro: true });
    expect(await code(() => handleProSeedCall(req(VALID, { uid: "pro", admin: undefined }), deps(db)))).toBe(
      "permission-denied:not_admin",
    );
  });

  it("requires an App Check token", async () => {
    expect(await code(() => handleProSeedCall(req(VALID, { app: false }), deps(world())))).toBe(
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
    [{ ...VALID, evidence: { ...VALID.evidence, url: "https://203.0.113.7/team" } }, "bad_evidence_url"],
    [{ ...VALID, evidence: { ...VALID.evidence, url: "https://[2001:db8::1]/team" } }, "bad_evidence_url"],
    [{ ...VALID, targetUid: "a/b" }, "bad_request"],
    [null, "bad_request"],
  ])("rejects bad input %#", async (data, expected) => {
    const db = world();
    expect(await code(() => handleProSeedCall(req(data), deps(db)))).toBe(`invalid-argument:${expected}`);
    expect(db.docs.has("proAudit/audit1")).toBe(false);
  });

  it.each([
    [{ username: "rookie", isVerifiedPro: true }, "failed-precondition:already_pro"],
    [{ username: "rookie", banned: true }, "failed-precondition:target_banned"],
  ])("refuses an ineligible target %#", async (target, expected) => {
    const db = world(target);
    expect(await code(() => handleProSeedCall(req(VALID), deps(db)))).toBe(expected);
    expect(db.docs.has("proAudit/audit1")).toBe(false);
  });

  it("refuses a missing target", async () => {
    const db = new Mem();
    expect(await code(() => handleProSeedCall(req(VALID), deps(db)))).toBe("not-found:not_found");
  });

  it("an admin cannot seed themselves", async () => {
    expect(await code(() => handleProSeedCall(req({ ...VALID, targetUid: ADMIN }), deps(world())))).toBe(
      "permission-denied:self_seed",
    );
  });

  it("pros are never admins: refuses a target holding the admin claim", async () => {
    const db = world();
    const isAdmin = vi.fn(async (uid: string) => uid === "sk8");
    expect(await code(() => handleProSeedCall(req(VALID), deps(db, isAdmin)))).toBe(
      "permission-denied:target_is_admin",
    );
    expect(isAdmin).toHaveBeenCalledWith("sk8");
    expect(db.docs.get("users/sk8")?.isVerifiedPro).toBeUndefined();
    expect(db.docs.has("proAudit/audit1")).toBe(false);
  });

  it("fails closed when the admin-claim lookup errors", async () => {
    const db = world();
    const isAdmin = async () => {
      throw new Error("auth down");
    };
    expect(await code(() => handleProSeedCall(req(VALID), deps(db, isAdmin)))).toBe("internal:seed_failed");
    expect(db.docs.has("proAudit/audit1")).toBe(false);
  });

  it("maps unexpected failures to internal", async () => {
    const db = world();
    db.failTx = new Error("boom");
    expect(await code(() => handleProSeedCall(req(VALID), deps(db)))).toBe("internal:seed_failed");
    db.failTx = "x" as unknown as Error;
    expect(await code(() => handleProSeedCall(req(VALID), deps(db)))).toBe("internal:seed_failed");
  });
});

describe("seedPro / parseSeedInput", () => {
  it("records the CLI as the source and tolerates a nameless profile", async () => {
    const db = world({});
    await seedPro({ db, isAdmin: notAdmin, stamp: "SERVER_TS" }, ADMIN, parseSeedInput(VALID), "cli");
    expect(db.docs.get("proAudit/audit1")).toMatchObject({ source: "cli", targetUsername: "", createdAt: "SERVER_TS" });
    expect(db.docs.get("users/sk8")).toMatchObject({ verifiedAt: "SERVER_TS", verifiedBy: ADMIN });
  });

  it("the CLI path refuses an admin target too", async () => {
    const db = world();
    await expect(
      seedPro({ db, isAdmin: async () => true, stamp: "TS" }, ADMIN, parseSeedInput(VALID), "cli"),
    ).rejects.toMatchObject({ code: "target_is_admin" });
    expect(db.docs.has("proAudit/audit1")).toBe(false);
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

describe("adminClaimLookup", () => {
  const auth = (impl: (uid: string) => Promise<{ customClaims?: Record<string, unknown> }>) => ({ getUser: impl });

  it("is true only for admin === true", async () => {
    expect(await adminClaimLookup(auth(async () => ({ customClaims: { admin: true } })))("u")).toBe(true);
    for (const claims of [{ admin: "true" }, { admin: 1 }, { admin: false }, {}, undefined]) {
      expect(await adminClaimLookup(auth(async () => ({ customClaims: claims })))("u")).toBe(false);
    }
  });

  it("treats a uid with no Auth record as not admin", async () => {
    const missing = auth(async () => {
      throw Object.assign(new Error("no user"), { code: "auth/user-not-found" });
    });
    expect(await adminClaimLookup(missing)("u")).toBe(false);
  });

  it("propagates any other lookup error (fail closed)", async () => {
    const down = auth(async () => {
      throw Object.assign(new Error("unavailable"), { code: "auth/internal-error" });
    });
    await expect(adminClaimLookup(down)("u")).rejects.toThrow("unavailable");
    await expect(adminClaimLookup(auth(async () => Promise.reject(null)))("u")).rejects.toBeNull();
  });
});
