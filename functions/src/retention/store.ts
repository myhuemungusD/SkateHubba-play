/** Admin SDK adapter for the game video retention job (gameVideos.ts). */

import type { Firestore } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";
import type { RetentionDeps, StoredObject } from "./gameVideos.js";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

const PAGE = 500;

export function adminRetentionDeps(db: Firestore, bucket: Bucket): RetentionDeps {
  return {
    async listGameObjects(): Promise<StoredObject[]> {
      const [files] = await bucket.getFiles({ prefix: "games/", autoPaginate: true });
      return files.map((file) => ({
        name: file.name,
        createdMs: Date.parse(String(file.metadata.timeCreated ?? "")) || Date.now(),
      }));
    },
    async readCollection(name: string): Promise<unknown[]> {
      const out: unknown[] = [];
      let query = db.collection(name).orderBy("__name__").limit(PAGE);
      for (;;) {
        const snap = await query.get();
        for (const doc of snap.docs) out.push(doc.data());
        if (snap.size < PAGE) return out;
        query = db
          .collection(name)
          .orderBy("__name__")
          .startAfter(snap.docs[snap.docs.length - 1])
          .limit(PAGE);
      }
    },
    async existingGameIds(gameIds: string[]): Promise<Set<string>> {
      const live = new Set<string>();
      for (let i = 0; i < gameIds.length; i += PAGE) {
        const refs = gameIds.slice(i, i + PAGE).map((id) => db.collection("games").doc(id));
        for (const snap of await db.getAll(...refs)) if (snap.exists) live.add(snap.id);
      }
      return live;
    },
    async deleteObject(name: string): Promise<void> {
      await bucket.file(name).delete({ ignoreNotFound: true });
    },
  };
}
