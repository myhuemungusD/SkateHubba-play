/**
 * Grail draws (SNKRS-style). Entry is free and earned by playing, never
 * bought, so a draw has no paid consideration and is not a lottery.
 *
 * Fairness: winners are the entries with the lowest sha256(seed:uid). The
 * seed comes from the server, is logged, and is published on the drop doc
 * after the draw, so anyone with the entrant list can recompute the result.
 */
import { createHash, randomBytes } from "node:crypto";
import { logger } from "firebase-functions/logger";
import { assertAccount, DROP_RULE } from "./access.js";
import { ClosetError, DAY_MS, num, parseDef, paths, str, toMillis, ts, type ClosetActor } from "./model.js";
import type { ClosetDb } from "./store.js";

export const DRAW_CLAIM_DAYS = 3;

export function newDrawSeed(): string {
  return randomBytes(16).toString("hex");
}

/** Deterministic pick: the `count` entrants with the lowest sha256(seed:uid). */
export function pickWinners(entrants: readonly string[], count: number, seed: string): string[] {
  const score = (uid: string) => createHash("sha256").update(`${seed}:${uid}`).digest("hex");
  return [...entrants]
    .map((uid) => ({ uid, key: score(uid) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, Math.max(0, count))
    .map((row) => row.uid);
}

export async function enterDraw(db: ClosetDb, actor: ClosetActor, dropId: string): Promise<{ entered: true }> {
  return db.runTransaction(async (tx) => {
    const drop = (await tx.get(paths.drop(dropId))).data;
    if (!drop) throw new ClosetError("not_found");
    if (drop.kind !== "draw") throw new ClosetError("not_a_draw");
    const start = toMillis(drop.startsAt);
    const end = toMillis(drop.endsAt);
    const live = drop.status === "open" && start !== null && end !== null && start <= actor.nowMs && actor.nowMs < end;
    if (!live) throw new ClosetError("drop_not_live");
    if ((await tx.get(paths.entry(dropId, actor.uid))).data) throw new ClosetError("already_entered");
    await assertAccount(tx, actor.uid, actor.nowMs, DROP_RULE);
    tx.set(paths.entry(dropId, actor.uid), { enteredAt: ts(actor.nowMs), won: false });
    tx.update(paths.drop(dropId), { entryCount: num(drop.entryCount) + 1 });
    return { entered: true };
  });
}

export interface DrawResult {
  dropId: string;
  seed: string;
  entries: number;
  winners: string[];
}

/** Run one closed draw. Returns null when it is not due (or already drawn). */
export async function runDraw(db: ClosetDb, dropId: string, nowMs: number, seed: string): Promise<DrawResult | null> {
  return db.runTransaction(async (tx) => {
    const drop = (await tx.get(paths.drop(dropId))).data;
    const end = toMillis(drop?.endsAt);
    if (!drop || drop.kind !== "draw" || drop.status !== "open" || end === null || end > nowMs) return null;
    const def = parseDef((await tx.get(paths.def(str(drop.itemDefId)))).data);
    const entrants = (await tx.query({ collection: paths.entries(dropId), filters: [] })).map((row) => row.id);
    const supply = def.edition.kind === "one_of_one" ? 1 : num(def.edition.supply);
    const winners = pickWinners(entrants, supply - def.edition.minted, seed);
    for (const uid of winners) tx.update(paths.entry(dropId, uid), { won: true });
    tx.update(paths.drop(dropId), {
      status: "drawn",
      drawSeed: seed,
      drawnAt: ts(nowMs),
      entryCount: entrants.length,
      winnerCount: winners.length,
      claimUntil: ts(nowMs + DRAW_CLAIM_DAYS * DAY_MS),
    });
    return { dropId, seed, entries: entrants.length, winners };
  });
}

/** Scheduled sweep: run every open draw whose entry window has closed. */
export async function runDueDraws(db: ClosetDb, nowMs: number, seedFn: () => string = newDrawSeed): Promise<number> {
  const open = await db.query({
    collection: "drops",
    filters: [
      { field: "kind", op: "==", value: "draw" },
      { field: "status", op: "==", value: "open" },
    ],
  });
  let ran = 0;
  for (const row of open) {
    const end = toMillis(row.data?.endsAt);
    if (end === null || end > nowMs) continue;
    try {
      const result = await runDraw(db, row.id, nowMs, seedFn());
      if (!result) continue;
      ran += 1;
      logger.info("closet_draw_run", {
        dropId: result.dropId,
        seed: result.seed,
        entries: result.entries,
        winners: result.winners.length,
      });
    } catch (err) {
      logger.error("closet_draw_failed", { dropId: row.id, message: err instanceof Error ? err.message : "unknown" });
    }
  }
  return ran;
}
