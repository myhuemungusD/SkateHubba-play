/**
 * In-memory DiceDb for the dice handler tests. Mirrors the Admin SDK rule
 * that a transaction cannot read after it writes, and rolls back on throw.
 */
import { setDieSource } from "./dice.js";
import type { DiceDb, DiceDoc, DiceQuery, DiceTx } from "./store.js";

export const NOW = 1_700_000_000_000;

export class MemoryDb implements DiceDb {
  docs = new Map<string, Record<string, unknown>>();
  added: Array<{ collection: string; data: Record<string, unknown> }> = [];
  private seq = 0;

  seed(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, { ...data });
  }

  async get(path: string): Promise<DiceDoc> {
    const data = this.docs.get(path);
    const id = path.split("/").pop() ?? path;
    return { id, data: data ? { ...data } : undefined };
  }

  async query(q: DiceQuery): Promise<DiceDoc[]> {
    const prefix = `${q.collection}/`;
    const matches: DiceDoc[] = [];
    for (const [path, data] of this.docs) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.includes("/")) continue;
      const ok = q.filters.every((filter) => {
        const value = data[filter.field];
        if (filter.op === "==") return value === filter.value;
        return typeof value === "number" && typeof filter.value === "number" && value < filter.value;
      });
      if (ok) matches.push({ id: rest, data: { ...data } });
    }
    return q.limit === undefined ? matches : matches.slice(0, q.limit);
  }

  async add(collection: string, data: Record<string, unknown>): Promise<void> {
    this.added.push({ collection, data });
  }

  newId(): string {
    this.seq += 1;
    return `game-${this.seq}`;
  }

  async runTransaction<T>(fn: (tx: DiceTx) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.docs);
    let wrote = false;
    const rejectReadAfterWrite = () => {
      if (wrote) throw new Error("read after write");
    };
    const tx: DiceTx = {
      get: (path) => {
        rejectReadAfterWrite();
        return this.get(path);
      },
      query: (q) => {
        rejectReadAfterWrite();
        return this.query(q);
      },
      set: (path, data, merge) => {
        wrote = true;
        const prev = merge ? this.docs.get(path) : undefined;
        this.docs.set(path, { ...(prev ?? {}), ...data });
      },
      update: (path, data) => {
        wrote = true;
        const prev = this.docs.get(path);
        if (!prev) throw new Error(`missing ${path}`);
        this.docs.set(path, { ...prev, ...data });
      },
    };
    try {
      return await fn(tx);
    } catch (err) {
      this.docs = snapshot;
      throw err;
    }
  }
}

export function seedPlayers(db: MemoryDb): void {
  db.seed("users/u1", { username: "jason" });
  db.seed("users/u2", { username: "remy" });
}

export function actor(uid: string, nowMs = NOW, emailVerified = true) {
  return { uid, nowMs, emailVerified };
}

/** Feed the server's die source a fixed sequence of faces. */
export function queueDice(...values: number[]): void {
  let i = 0;
  setDieSource(() => {
    if (i >= values.length) throw new Error("die queue exhausted");
    return values[i++]!;
  });
}
