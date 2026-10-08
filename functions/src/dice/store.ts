/**
 * Narrow database port so the dice handlers can be tested with an in-memory
 * fake. The Admin SDK adapter is the only production implementation.
 */
import type { DocumentReference, Firestore, Query } from "firebase-admin/firestore";

export interface DiceFilter {
  field: string;
  op: "==" | "<";
  value: unknown;
}

export interface DiceQuery {
  collection: string;
  filters: readonly DiceFilter[];
  limit?: number;
}

export interface DiceDoc {
  id: string;
  data: Record<string, unknown> | undefined;
}

export interface DiceTx {
  get(path: string): Promise<DiceDoc>;
  query(q: DiceQuery): Promise<DiceDoc[]>;
  set(path: string, data: Record<string, unknown>, merge?: boolean): void;
  update(path: string, data: Record<string, unknown>): void;
}

export interface DiceDb {
  get(path: string): Promise<DiceDoc>;
  query(q: DiceQuery): Promise<DiceDoc[]>;
  add(collection: string, data: Record<string, unknown>): Promise<void>;
  newId(collection: string): string;
  runTransaction<T>(fn: (tx: DiceTx) => Promise<T>): Promise<T>;
}

function refFromPath(db: Firestore, path: string): DocumentReference {
  const parts = path.split("/").filter((part) => part.length > 0);
  if (parts.length < 2 || parts.length % 2 !== 0) {
    throw new Error("BAD_PATH");
  }
  let ref: DocumentReference = db.collection(parts[0]!).doc(parts[1]!);
  for (let i = 2; i < parts.length; i += 2) {
    ref = ref.collection(parts[i]!).doc(parts[i + 1]!);
  }
  return ref;
}

function buildQuery(db: Firestore, q: DiceQuery): Query {
  let query: Query = db.collection(q.collection);
  for (const filter of q.filters) {
    query = query.where(filter.field, filter.op, filter.value);
  }
  if (q.limit !== undefined) query = query.limit(q.limit);
  return query;
}

function asData(raw: FirebaseFirestore.DocumentData | undefined): Record<string, unknown> | undefined {
  return raw;
}

/** Adapt the Admin SDK to {@link DiceDb}. */
export function adminDiceDb(db: Firestore): DiceDb {
  return {
    async get(path) {
      const snap = await refFromPath(db, path).get();
      return { id: snap.id, data: snap.exists ? asData(snap.data()) : undefined };
    },
    async query(q) {
      const snap = await buildQuery(db, q).get();
      return snap.docs.map((doc) => ({ id: doc.id, data: asData(doc.data()) }));
    },
    async add(collection, data) {
      await db.collection(collection).add(data);
    },
    newId(collection) {
      return db.collection(collection).doc().id;
    },
    runTransaction(fn) {
      return db.runTransaction(async (tx) => {
        const wrapped: DiceTx = {
          async get(path) {
            const snap = await tx.get(refFromPath(db, path));
            return { id: snap.id, data: snap.exists ? asData(snap.data()) : undefined };
          },
          async query(q) {
            const snap = await tx.get(buildQuery(db, q));
            return snap.docs.map((doc) => ({ id: doc.id, data: asData(doc.data()) }));
          },
          set(path, data, merge) {
            tx.set(refFromPath(db, path), data, { merge: merge === true });
          },
          update(path, data) {
            tx.update(refFromPath(db, path), data);
          },
        };
        return fn(wrapped);
      });
    },
  };
}
