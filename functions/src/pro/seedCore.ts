/**
 * Core of a Verified-Pro seed, shared by the `proSeed` callable
 * (functions/src/pro/seed.ts) and the operator CLI (scripts/grant-pro.ts).
 *
 * Runtime-dependency-free on purpose (type-only imports), so the CLI can run it
 * against its own firebase-admin instance: the caller injects the database,
 * the admin-claim lookup and the timestamp value to write.
 *
 * Rules enforced here, for both paths:
 *  - no self-seed;
 *  - pros are never admins: a target holding the `admin` custom claim is
 *    refused (`target_is_admin`), so a seed can never put a gold handle on a
 *    staff account;
 *  - the target must exist, not be pro already and not be banned;
 *  - the badge and an append-only `proAudit/{id}` row are written in ONE
 *    transaction.
 */
import type { DiceDb } from "../dice/store.js";
import type { SeedInput } from "./seedInput.js";

export const PRO_AUDIT_COLLECTION = "proAudit";

export type SeedSource = "callable" | "cli";

export interface SeedProDeps {
  db: DiceDb;
  /** True when `uid` holds the `admin === true` custom claim. Errors propagate (fail closed). */
  isAdmin: (uid: string) => Promise<boolean>;
  /** Value written to verifiedAt / createdAt (a Timestamp or serverTimestamp()). */
  stamp: unknown;
}

export interface ProSeedResult {
  auditId: string;
  status: "seeded";
}

export class SeedError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SeedError";
  }
}

/** Minimal slice of firebase-admin Auth, so the lookup stays testable and package-agnostic. */
export interface ClaimsReader {
  getUser(uid: string): Promise<{ customClaims?: Record<string, unknown> | undefined }>;
}

/**
 * `isAdmin` backed by Firebase Auth custom claims. A uid with no Auth record
 * is not an admin (the seed then fails on the missing profile); any other
 * lookup error propagates so the seed fails closed.
 */
export function adminClaimLookup(auth: ClaimsReader): (uid: string) => Promise<boolean> {
  return async (uid) => {
    try {
      return (await auth.getUser(uid)).customClaims?.admin === true;
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === "auth/user-not-found") return false;
      throw err;
    }
  };
}

export async function seedPro(
  deps: SeedProDeps,
  actorUid: string,
  input: SeedInput,
  source: SeedSource,
): Promise<ProSeedResult> {
  if (input.targetUid === actorUid) throw new SeedError("self_seed");
  if (await deps.isAdmin(input.targetUid)) throw new SeedError("target_is_admin");
  const { db, stamp } = deps;
  const auditId = db.newId(PRO_AUDIT_COLLECTION);
  return db.runTransaction(async (tx) => {
    const target = (await tx.get(`users/${input.targetUid}`)).data;
    if (!target) throw new SeedError("not_found");
    if (target.isVerifiedPro === true) throw new SeedError("already_pro");
    if (target.banned === true) throw new SeedError("target_banned");
    tx.update(`users/${input.targetUid}`, { isVerifiedPro: true, verifiedBy: actorUid, verifiedAt: stamp });
    tx.set(`${PRO_AUDIT_COLLECTION}/${auditId}`, {
      action: "seed",
      actorUid,
      targetUid: input.targetUid,
      targetUsername: typeof target.username === "string" ? target.username : "",
      reason: input.reason,
      evidenceCompany: input.evidenceCompany,
      evidenceUrl: input.evidenceUrl,
      source,
      createdAt: stamp,
    });
    return { auditId, status: "seeded" as const };
  });
}
