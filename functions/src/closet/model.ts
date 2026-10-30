/**
 * Closet data model. Every doc below is written only by these functions
 * (Admin SDK); clients read through Firestore rules and write nothing.
 *
 *   catalog/{itemDefId}             item definition, public read
 *   users/{uid}/locker/{copyId}     one owned copy (existing collection)
 *   serials/{itemDefId_serial}      serial ledger, the source of truth
 *   users/{uid}/wallet/main         balance, earnedBal, boughtBal
 *   users/{uid}/ledger/{txId}       append-only Bucks transactions
 *   users/{uid}/closetLimits/daily  server-only daily counters (no client read)
 *   drops/{dropId}                  a drop; claims/{uid} and entries/{uid} under it
 *   trades/{tradeId}                a trade between two skaters
 *   closetAudit/{autoId}            admin catalog / reversal actions
 *
 * Open-edition copies use the itemDefId as the copyId (one per skater);
 * serialized copies use `${itemDefId}_${serial}`.
 */
import { Timestamp } from "firebase-admin/firestore";

export const DAY_MS = 86_400_000;

const RARITIES = ["common", "uncommon", "rare", "limited", "grail"] as const;
export type Rarity = (typeof RARITIES)[number];

const SLOTS = ["head", "top", "bottom", "shoes", "deck", "accessory"] as const;
export type Slot = (typeof SLOTS)[number];

const EDITION_KINDS = ["open", "limited", "one_of_one"] as const;
export type EditionKind = (typeof EDITION_KINDS)[number];

/** `shop` marks open-edition items sold in the daily shop. */
const SOURCES = ["earn", "drop", "pro_signature", "event", "shop"] as const;
export type Source = (typeof SOURCES)[number];

interface Edition {
  kind: EditionKind;
  supply: number | null;
  minted: number;
  soldOut: boolean;
}

export interface CatalogDef {
  name: string;
  type: string;
  slot: Slot;
  rarity: Rarity;
  artUrl: string;
  layerUrls: { front: string; back: string | null };
  model3dUrl: string | null;
  edition: Edition;
  source: Source;
  priceBucks: number | null;
  dropId: string | null;
  licensed: { brand: string | null; licenseRef: string | null };
  releasedAtMs: number | null;
  retiredAtMs: number | null;
}

export class ClosetError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ClosetError";
  }
}

export interface ClosetActor {
  uid: string;
  nowMs: number;
  emailVerified: boolean;
  /** The current sign-in used a second factor (TOTP / phone). */
  secondFactor: boolean;
  /** `firebase.sign_in_provider` from the ID token, e.g. "google.com". */
  provider: string;
  isAdmin: boolean;
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function toMillis(value: unknown): number | null {
  if (value instanceof Timestamp) return value.toMillis();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

export function ts(ms: number): Timestamp {
  return Timestamp.fromMillis(ms);
}

export function utcDay(ms: number): number {
  return Math.floor(ms / DAY_MS);
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return list.includes(value as T) ? (value as T) : null;
}

export const asRarity = (v: unknown): Rarity | null => oneOf(RARITIES, v);
export const asSlot = (v: unknown): Slot | null => oneOf(SLOTS, v);
export const asEditionKind = (v: unknown): EditionKind | null => oneOf(EDITION_KINDS, v);
export const asSource = (v: unknown): Source | null => oneOf(SOURCES, v);

function nullableStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse a stored catalog doc. Throws `bad_item` when it cannot be sold or minted safely. */
export function parseDef(raw: Record<string, unknown> | undefined): CatalogDef {
  if (!raw) throw new ClosetError("not_found");
  const slot = asSlot(raw.slot);
  const rarity = asRarity(raw.rarity);
  const source = asSource(raw.source);
  const edition = (raw.edition ?? {}) as Record<string, unknown>;
  const kind = asEditionKind(edition.kind);
  if (!slot || !rarity || !source || !kind || !str(raw.name)) throw new ClosetError("bad_item");
  const layers = (raw.layerUrls ?? {}) as Record<string, unknown>;
  const licensed = (raw.licensed ?? {}) as Record<string, unknown>;
  return {
    name: str(raw.name),
    type: str(raw.type),
    slot,
    rarity,
    artUrl: str(raw.artUrl),
    layerUrls: { front: str(layers.front), back: nullableStr(layers.back) },
    model3dUrl: nullableStr(raw.model3dUrl),
    edition: {
      kind,
      supply: typeof edition.supply === "number" ? edition.supply : null,
      minted: num(edition.minted),
      soldOut: edition.soldOut === true,
    },
    source,
    priceBucks: typeof raw.priceBucks === "number" ? raw.priceBucks : null,
    dropId: nullableStr(raw.dropId),
    licensed: { brand: nullableStr(licensed.brand), licenseRef: nullableStr(licensed.licenseRef) },
    releasedAtMs: toMillis(raw.releasedAt),
    retiredAtMs: toMillis(raw.retiredAt),
  };
}

export function isReleased(def: CatalogDef, nowMs: number): boolean {
  if (def.retiredAtMs !== null && def.retiredAtMs <= nowMs) return false;
  return def.releasedAtMs !== null && def.releasedAtMs <= nowMs;
}

/** Firestore ids: non-empty, bounded, no path separator. */
export function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 128 && !value.includes("/");
}

export const paths = {
  user: (uid: string) => `users/${uid}`,
  ban: (uid: string) => `bans/${uid}`,
  copy: (uid: string, copyId: string) => `users/${uid}/locker/${copyId}`,
  locker: (uid: string) => `users/${uid}/locker`,
  wallet: (uid: string) => `users/${uid}/wallet/main`,
  ledger: (uid: string, txId: string) => `users/${uid}/ledger/${txId}`,
  limits: (uid: string) => `users/${uid}/closetLimits/daily`,
  def: (id: string) => `catalog/${id}`,
  serial: (defId: string, serial: number) => `serials/${defId}_${serial}`,
  drop: (id: string) => `drops/${id}`,
  claim: (dropId: string, uid: string) => `drops/${dropId}/claims/${uid}`,
  entries: (dropId: string) => `drops/${dropId}/entries`,
  entry: (dropId: string, uid: string) => `drops/${dropId}/entries/${uid}`,
  trade: (id: string) => `trades/${id}`,
};
