/**
 * Database port for the closet. Same shape as the dice port plus `delete`,
 * which a trade needs to move a locker copy from one owner to the other.
 */
import type { Firestore } from "firebase-admin/firestore";
import { buildQuery, refFromPath, type DiceDoc, type DiceQuery, type DiceTx } from "../dice/store.js";

export interface ClosetTx extends DiceTx {
  delete(path: string): void;
}

export interface ClosetDb {
  get(path: string): Promise<DiceDoc>;
  query(q: DiceQuery): Promise<DiceDoc[]>;
  newId(collection: string): string;
  runTransaction<T>(fn: (tx: ClosetTx) => Promise<T>): Promise<T>;
}

/** Adapt the Admin SDK to {@link ClosetDb}. */
export function adminClosetDb(db: Firestore): ClosetDb {
  return {
    async get(path) {
      const snap = await refFromPath(db, path).get();
      return { id: snap.id, data: snap.exists ? snap.data() : undefined };
    },
    async query(q) {
      const snap = await buildQuery(db, q).get();
      return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
    },
    newId(collection) {
      return db.collection(collection).doc().id;
    },
    runTransaction(fn) {
      return db.runTransaction(async (tx) =>
        fn({
          async get(path) {
            const snap = await tx.get(refFromPath(db, path));
            return { id: snap.id, data: snap.exists ? snap.data() : undefined };
          },
          async query(q) {
            const snap = await tx.get(buildQuery(db, q));
            return snap.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
          },
          set(path, data, merge) {
            tx.set(refFromPath(db, path), data, { merge: merge === true });
          },
          update(path, data) {
            tx.update(refFromPath(db, path), data);
          },
          delete(path) {
            tx.delete(refFromPath(db, path));
          },
        }),
      );
    },
  };
}
