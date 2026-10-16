/**
 * Pro blessing actions. Every write goes through the Admin SDK inside a
 * transaction; Firestore rules give clients no write path to isVerifiedPro,
 * verifiedBy, verifiedAt or /proBlessings.
 *
 * Record: proBlessings/{autoId}
 *   blesserUid, blesserUsername, targetUid, targetUsername, reason,
 *   status (pending → accepted | declined | expired; accepted → revoked),
 *   createdAt, respondedAt?, revokedAt?, revokedBy?, revokeReason?
 * Records are never deleted, so the lineage (who blessed whom) survives a revoke.
 */
import { Timestamp } from "firebase-admin/firestore";
import type { DiceDb, DiceTx } from "../dice/store.js";
import { accountOldEnough, blessingsInWindow, cleanReason, offerExpired, type BlessingConfig } from "./rules.js";

export class BlessingError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "BlessingError";
  }
}

export interface BlessingActor {
  uid: string;
  emailVerified: boolean;
  nowMs: number;
}

export interface BlessingResult {
  blessingId: string;
  status: string;
}

const COLLECTION = "proBlessings";

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function mustUser(tx: DiceTx, uid: string, missing: string): Promise<Record<string, unknown>> {
  const doc = await tx.get(`users/${uid}`);
  if (!doc.data) throw new BlessingError(missing);
  return doc.data;
}

function notify(
  tx: DiceTx,
  id: string,
  n: { to: string; from: string; type: string; title: string; body: string; blessingId: string },
) {
  tx.set(`notifications/${id}`, {
    senderUid: n.from,
    recipientUid: n.to,
    type: n.type,
    title: n.title.slice(0, 80),
    body: n.body.slice(0, 200),
    blessingId: n.blessingId,
    read: false,
    createdAt: Timestamp.now(),
  });
}

export async function blessSkater(
  db: DiceDb,
  actor: BlessingActor,
  targetUid: string,
  rawReason: unknown,
  config: BlessingConfig,
): Promise<BlessingResult> {
  if (!actor.emailVerified) throw new BlessingError("email_unverified");
  if (targetUid === actor.uid) throw new BlessingError("self_blessing");
  const reason = cleanReason(rawReason);
  if (!reason) throw new BlessingError("bad_reason");
  const blessingId = db.newId(COLLECTION);

  return db.runTransaction(async (tx) => {
    const blesser = await mustUser(tx, actor.uid, "not_a_pro");
    if (blesser.isVerifiedPro !== true || blesser.banned === true) throw new BlessingError("not_a_pro");
    const target = await mustUser(tx, targetUid, "not_found");
    if (target.isVerifiedPro === true) throw new BlessingError("already_pro");
    if (target.banned === true) throw new BlessingError("not_eligible");
    const blocked = await tx.get(`users/${targetUid}/blocked_users/${actor.uid}`);
    if (blocked.data) throw new BlessingError("not_eligible");
    if (!accountOldEnough(target.createdAt, actor.nowMs, config.minAccountAgeDays)) {
      throw new BlessingError("account_too_new");
    }

    const open = await tx.query({
      collection: COLLECTION,
      filters: [
        { field: "targetUid", op: "==", value: targetUid },
        { field: "status", op: "==", value: "pending" },
      ],
    });
    if (open.some((row) => !offerExpired(row.data?.createdAt, actor.nowMs, config.offerTtlDays))) {
      throw new BlessingError("already_offered");
    }

    const mine = await tx.query({
      collection: COLLECTION,
      filters: [{ field: "blesserUid", op: "==", value: actor.uid }],
      limit: 200,
    });
    const used = blessingsInWindow(
      mine.map((row) => row.data?.createdAt),
      actor.nowMs,
      config.windowDays,
    );
    if (used >= config.limit) throw new BlessingError("limit_reached");

    for (const row of open) tx.update(`${COLLECTION}/${row.id}`, { status: "expired" });
    const blesserUsername = str(blesser.username);
    tx.set(`${COLLECTION}/${blessingId}`, {
      blesserUid: actor.uid,
      blesserUsername,
      targetUid,
      targetUsername: str(target.username),
      reason,
      status: "pending",
      createdAt: Timestamp.fromMillis(actor.nowMs),
    });
    notify(tx, `pro_blessing_${blessingId}`, {
      to: targetUid,
      from: actor.uid,
      type: "pro_blessing",
      title: "You've been blessed",
      body: `@${blesserUsername} wants to turn you pro on SkateHubba.`,
      blessingId,
    });
    return { blessingId, status: "pending" };
  });
}

export async function respondToBlessing(
  db: DiceDb,
  actor: BlessingActor,
  blessingId: string,
  accept: boolean,
  config: BlessingConfig,
): Promise<BlessingResult> {
  return db.runTransaction(async (tx) => {
    const doc = await tx.get(`${COLLECTION}/${blessingId}`);
    const row = doc.data;
    if (!row) throw new BlessingError("not_found");
    if (row.targetUid !== actor.uid) throw new BlessingError("not_yours");
    if (row.status !== "pending") throw new BlessingError("not_pending");
    const path = `${COLLECTION}/${blessingId}`;
    const now = Timestamp.fromMillis(actor.nowMs);
    if (offerExpired(row.createdAt, actor.nowMs, config.offerTtlDays)) {
      tx.update(path, { status: "expired" });
      return { blessingId, status: "expired" };
    }
    if (!accept) {
      tx.update(path, { status: "declined", respondedAt: now });
      return { blessingId, status: "declined" };
    }
    const blesserUid = str(row.blesserUid);
    const target = await mustUser(tx, actor.uid, "not_found");
    if (target.banned === true) throw new BlessingError("not_eligible");
    if (target.isVerifiedPro === true) throw new BlessingError("already_pro");
    const blesser = await mustUser(tx, blesserUid, "blesser_not_pro");
    if (blesser.isVerifiedPro !== true || blesser.banned === true) throw new BlessingError("blesser_not_pro");

    tx.update(path, { status: "accepted", respondedAt: now });
    tx.update(`users/${actor.uid}`, { isVerifiedPro: true, verifiedBy: blesserUid, verifiedAt: now });
    notify(tx, `pro_blessing_accepted_${blessingId}`, {
      to: blesserUid,
      from: actor.uid,
      type: "pro_blessing_accepted",
      title: "They turned pro",
      body: `@${str(target.username)} accepted your blessing. Welcome them in.`,
      blessingId,
    });
    return { blessingId, status: "accepted" };
  });
}

/** Admin-only. Clears pro, stamps the revoking admin, keeps every record. */
export async function revokePro(
  db: DiceDb,
  actor: BlessingActor,
  targetUid: string,
  rawReason: unknown,
): Promise<BlessingResult> {
  const reason = cleanReason(rawReason);
  if (!reason) throw new BlessingError("bad_reason");
  return db.runTransaction(async (tx) => {
    const target = await mustUser(tx, targetUid, "not_found");
    if (target.isVerifiedPro !== true) throw new BlessingError("not_a_pro");
    const accepted = await tx.query({
      collection: COLLECTION,
      filters: [
        { field: "targetUid", op: "==", value: targetUid },
        { field: "status", op: "==", value: "accepted" },
      ],
    });
    const now = Timestamp.fromMillis(actor.nowMs);
    for (const row of accepted) {
      tx.update(`${COLLECTION}/${row.id}`, {
        status: "revoked",
        revokedAt: now,
        revokedBy: actor.uid,
        revokeReason: reason,
      });
    }
    tx.update(`users/${targetUid}`, { isVerifiedPro: false, verifiedBy: actor.uid, verifiedAt: now });
    return { blessingId: accepted[0]?.id ?? "", status: "revoked" };
  });
}
