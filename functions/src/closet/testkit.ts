/**
 * In-memory ClosetDb for tests. Excluded from the build (tsconfig). Mirrors
 * the two transaction rules that matter: reads must come before writes, and
 * `update` fails on a missing doc. Dotted update keys write nested fields.
 */
import { Timestamp } from "firebase-admin/firestore";
import type { DiceDoc, DiceQuery } from "../dice/store.js";
import { DAY_MS, type ClosetActor } from "./model.js";
import type { ClosetDb, ClosetTx } from "./store.js";

export const NOW = 1_800_000_000_000;
export const OLD = Timestamp.fromMillis(NOW - 90 * DAY_MS);

function clone<T>(value: T): T {
  if (value instanceof Timestamp || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone) as T;
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clone(v)])) as T;
}

function setPath(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    node[part] = next && typeof next === "object" ? { ...(next as object) } : {};
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]!] = value;
}

function compare(a: unknown, b: unknown): number {
  const av = a instanceof Timestamp ? a.toMillis() : (a as number);
  const bv = b instanceof Timestamp ? b.toMillis() : (b as number);
  return av - bv;
}

export class MemDb implements ClosetDb {
  docs = new Map<string, Record<string, unknown>>();
  private seq = 0;
  failNextTx: Error | null = null;

  seed(path: string, data: Record<string, unknown>): this {
    this.docs.set(path, data);
    return this;
  }

  doc(path: string): Record<string, unknown> | undefined {
    return this.docs.get(path);
  }

  async get(path: string): Promise<DiceDoc> {
    const data = this.docs.get(path);
    return { id: path.split("/").pop()!, data: data ? clone(data) : undefined };
  }

  async query(q: DiceQuery): Promise<DiceDoc[]> {
    const out: DiceDoc[] = [];
    for (const [path, data] of this.docs) {
      const rest = path.slice(q.collection.length + 1);
      if (!path.startsWith(`${q.collection}/`) || rest.includes("/")) continue;
      const ok = q.filters.every((f) =>
        f.op === "==" ? data[f.field] === f.value : compare(data[f.field], f.value) < 0,
      );
      if (ok) out.push({ id: rest, data: clone(data) });
    }
    return q.limit === undefined ? out : out.slice(0, q.limit);
  }

  newId(collection: string): string {
    this.seq += 1;
    return `${collection.split("/").pop()}${this.seq}`;
  }

  async runTransaction<T>(fn: (tx: ClosetTx) => Promise<T>): Promise<T> {
    if (this.failNextTx) {
      const err = this.failNextTx;
      this.failNextTx = null;
      throw err;
    }
    const staged = new Map(this.docs);
    let wrote = false;
    const guard = (): void => {
      if (wrote) throw new Error("read after write");
    };
    const tx: ClosetTx = {
      get: (p) => (guard(), this.get(p)),
      query: (q) => (guard(), this.query(q)),
      set: (p, d) => {
        wrote = true;
        staged.set(p, clone(d));
      },
      update: (p, d) => {
        wrote = true;
        const prev = staged.get(p);
        if (!prev) throw new Error(`missing ${p}`);
        const next = clone(prev);
        for (const [k, v] of Object.entries(d)) setPath(next, k, clone(v));
        staged.set(p, next);
      },
      delete: (p) => {
        wrote = true;
        staged.delete(p);
      },
    };
    const result = await fn(tx);
    this.docs = staged;
    return result;
  }
}

export function actor(uid: string, over: Partial<ClosetActor> = {}): ClosetActor {
  return {
    uid,
    nowMs: NOW,
    emailVerified: true,
    secondFactor: true,
    provider: "password",
    isAdmin: false,
    ...over,
  };
}

/** A user old enough with enough games for drops and trading. */
export function seedUser(db: MemDb, uid: string, over: Record<string, unknown> = {}): MemDb {
  return db.seed(`users/${uid}`, { username: uid, createdAt: OLD, gamesPlayed: 10, ...over });
}

export function seedWallet(db: MemDb, uid: string, balance: number, boughtBal = 0): MemDb {
  return db.seed(`users/${uid}/wallet/main`, { balance, earnedBal: balance - boughtBal, boughtBal });
}

export function defDoc(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "'99 Puffy Skate Shoe",
    type: "shoes",
    slot: "shoes",
    rarity: "limited",
    artUrl: "https://cdn.example/puffy.png",
    layerUrls: { front: "https://cdn.example/puffy-front.png", back: null },
    edition: { kind: "limited", supply: 150, minted: 0, soldOut: false },
    source: "drop",
    priceBucks: 1000,
    dropId: "d1",
    licensed: {},
    releasedAt: Timestamp.fromMillis(NOW - DAY_MS),
    retiredAt: null,
    ...over,
  };
}

export function copyDoc(itemDefId: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    itemDefId,
    name: itemDefId,
    type: "deck",
    slot: "deck",
    rarity: "common",
    serial: null,
    equipped: false,
    tradableAfter: Timestamp.fromMillis(NOW - DAY_MS),
    provenance: { reason: "shop", dropId: null, prevOwners: [], mintedAt: OLD },
    ...over,
  };
}

/** Run `fn` and return the ClosetError / HttpsError message it threw. */
export async function errorCode(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected failure");
}
