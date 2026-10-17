/**
 * Catalog management. Admin-only (checked by the callable), always inside a
 * transaction, and every action leaves a closetAudit row.
 *
 * Supply rules: a limited run can be ended early (supply lowered to what is
 * already minted) but never raised once minting has started. No reprints.
 */
import {
  DAY_MS,
  ClosetError,
  asEditionKind,
  asRarity,
  asSlot,
  asSource,
  isId,
  parseDef,
  paths,
  str,
  ts,
} from "./model.js";
import type { ClosetActor, EditionKind, Rarity } from "./model.js";
import { priceFits } from "./economy.js";
import { isSerialized } from "./mint.js";
import type { ClosetDb, ClosetTx } from "./store.js";

const LIMITED_SUPPLY = { min: 100, max: 1000 };
const GRAIL_SUPPLY = { min: 1, max: 50 };
const PREVIEW_MS = 2 * DAY_MS;

export function writeAudit(
  tx: ClosetTx,
  db: ClosetDb,
  actor: ClosetActor,
  action: string,
  target: string,
  details: object,
): void {
  tx.set(`closetAudit/${db.newId("closetAudit")}`, {
    actorUid: actor.uid,
    action,
    target,
    details,
    at: ts(actor.nowMs),
  });
}

function text(value: unknown, max: number): string {
  const s = str(value).trim();
  if (s.length === 0 || s.length > max) throw new ClosetError("bad_request");
  return s;
}

function httpsUrl(value: unknown, optional = false): string | null {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const s = str(value);
  if (!s.startsWith("https://") || s.length > 500) throw new ClosetError("bad_request");
  return s;
}

function optionalMs(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new ClosetError("bad_request");
  return value;
}

function editionFor(rarity: Rarity, kind: EditionKind, rawSupply: unknown): number | null {
  if (rarity === "common" || rarity === "uncommon" || rarity === "rare") {
    if (kind !== "open") throw new ClosetError("bad_edition");
    return null;
  }
  if (kind === "one_of_one") {
    if (rarity !== "grail") throw new ClosetError("bad_edition");
    return 1;
  }
  const range = rarity === "limited" ? LIMITED_SUPPLY : GRAIL_SUPPLY;
  const supply = typeof rawSupply === "number" ? rawSupply : NaN;
  if (kind !== "limited" || !Number.isInteger(supply) || supply < range.min || supply > range.max) {
    throw new ClosetError("bad_edition");
  }
  return supply;
}

/** Validate an admin's item input into the stored catalog shape. Pure. */
export function buildDefDoc(raw: Record<string, unknown>, actor: ClosetActor): Record<string, unknown> {
  const rarity = asRarity(raw.rarity);
  const slot = asSlot(raw.slot);
  const source = asSource(raw.source);
  const kind = asEditionKind(raw.editionKind);
  if (!rarity || !slot || !source || !kind) throw new ClosetError("bad_request");
  const supply = editionFor(rarity, kind, raw.supply);
  if (source === "pro_signature" && rarity !== "grail") throw new ClosetError("bad_edition");
  const price = raw.priceBucks === undefined || raw.priceBucks === null ? null : Number(raw.priceBucks);
  if (!priceFits(rarity, price)) throw new ClosetError("bad_price");
  if (source === "shop" && (kind !== "open" || price === null)) throw new ClosetError("bad_price");
  const brand = str(raw.brand).trim();
  const licenseRef = str(raw.licenseRef).trim();
  // A real brand name needs a signed license on file (plan §10).
  if (brand && !licenseRef) throw new ClosetError("license_required");
  const layers = (raw.layerUrls ?? {}) as Record<string, unknown>;
  const releasedMs = optionalMs(raw.releasedAtMs);
  return {
    name: text(raw.name, 80),
    type: text(raw.type, 40),
    slot,
    rarity,
    artUrl: httpsUrl(raw.artUrl),
    layerUrls: { front: httpsUrl(layers.front), back: httpsUrl(layers.back, true) },
    model3dUrl: httpsUrl(raw.model3dUrl, true),
    edition: { kind, supply, minted: 0, soldOut: false },
    source,
    priceBucks: price,
    dropId: null,
    licensed: { brand: brand || null, licenseRef: licenseRef || null },
    releasedAt: releasedMs === null ? null : ts(releasedMs),
    retiredAt: null,
    createdBy: actor.uid,
    createdAt: ts(actor.nowMs),
  };
}

export async function createItem(
  db: ClosetDb,
  actor: ClosetActor,
  itemDefId: string,
  raw: Record<string, unknown>,
): Promise<{ itemDefId: string }> {
  if (!isId(itemDefId)) throw new ClosetError("bad_request");
  const doc = buildDefDoc(raw, actor);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(paths.def(itemDefId))).data) throw new ClosetError("already_exists");
    tx.set(paths.def(itemDefId), doc);
    writeAudit(tx, db, actor, "create_item", itemDefId, { rarity: doc.rarity, edition: doc.edition });
    return { itemDefId };
  });
}

export async function updateStock(
  db: ClosetDb,
  actor: ClosetActor,
  itemDefId: string,
  supply: unknown,
): Promise<{ supply: number; soldOut: boolean }> {
  return db.runTransaction(async (tx) => {
    const def = parseDef((await tx.get(paths.def(itemDefId))).data);
    if (def.edition.kind !== "limited") throw new ClosetError("bad_edition");
    const current = def.edition.supply ?? 0;
    const minted = def.edition.minted;
    const range = def.rarity === "grail" ? GRAIL_SUPPLY : LIMITED_SUPPLY;
    const next = typeof supply === "number" && Number.isInteger(supply) ? supply : NaN;
    if (!(next >= 0)) throw new ClosetError("bad_request");
    if (minted > 0 && (next > current || next < minted)) throw new ClosetError("no_reprint");
    if (minted === 0 && (next < range.min || next > range.max)) throw new ClosetError("bad_edition");
    const soldOut = def.edition.soldOut || next <= minted;
    tx.update(paths.def(itemDefId), { "edition.supply": next, "edition.soldOut": soldOut });
    writeAudit(tx, db, actor, "update_stock", itemDefId, { from: current, to: next, minted });
    return { supply: next, soldOut };
  });
}

export async function retireItem(db: ClosetDb, actor: ClosetActor, itemDefId: string): Promise<{ retired: true }> {
  return db.runTransaction(async (tx) => {
    const def = parseDef((await tx.get(paths.def(itemDefId))).data);
    if (def.retiredAtMs !== null) throw new ClosetError("already_retired");
    tx.update(paths.def(itemDefId), { retiredAt: ts(actor.nowMs) });
    writeAudit(tx, db, actor, "retire_item", itemDefId, {});
    return { retired: true };
  });
}

export async function createDrop(
  db: ClosetDb,
  actor: ClosetActor,
  dropId: string,
  raw: Record<string, unknown>,
): Promise<{ dropId: string }> {
  if (!isId(dropId) || !isId(raw.itemDefId)) throw new ClosetError("bad_request");
  const itemDefId = raw.itemDefId;
  const kind = raw.kind === "fcfs" || raw.kind === "draw" ? raw.kind : null;
  const startsAt = optionalMs(raw.startsAtMs);
  const endsAt = optionalMs(raw.endsAtMs);
  if (!kind || startsAt === null || endsAt === null || endsAt <= startsAt) throw new ClosetError("bad_request");
  const title = text(raw.title, 80);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(paths.drop(dropId))).data) throw new ClosetError("already_exists");
    const def = parseDef((await tx.get(paths.def(itemDefId))).data);
    if (!isSerialized(def) || def.dropId !== null || def.edition.minted > 0) throw new ClosetError("bad_edition");
    if ((kind === "fcfs") !== (def.rarity === "limited")) throw new ClosetError("bad_edition");
    tx.set(paths.drop(dropId), {
      itemDefId,
      kind,
      title,
      rarity: def.rarity,
      priceBucks: def.priceBucks ?? 0,
      supply: def.edition.kind === "one_of_one" ? 1 : def.edition.supply,
      previewAt: ts(startsAt - PREVIEW_MS),
      startsAt: ts(startsAt),
      endsAt: ts(endsAt),
      status: "open",
      entryCount: 0,
      claimCount: 0,
      createdAt: ts(actor.nowMs),
    });
    tx.update(paths.def(itemDefId), { dropId, releasedAt: ts(startsAt) });
    writeAudit(tx, db, actor, "create_drop", dropId, { itemDefId, kind });
    return { dropId };
  });
}
