/** Admin SDK adapter for the game video retention job (gameVideos.ts). */

import type { Firestore } from "firebase-admin/firestore";
import type { getStorage } from "firebase-admin/storage";
import type { GameDoc, RetentionDeps, StoredObject } from "./gameVideos.js";

type Bucket = ReturnType<ReturnType<typeof getStorage>["bucket"]>;

const PAGE = 500;
const LIST_PAGE = 1000;

export function adminRetentionDeps(db: Firestore, bucket: Bucket): RetentionDeps {
  async function getAllIn<T>(
    collection: string,
    ids: string[],
    fieldMask: string[],
    each: (id: string, data: T) => void,
  ): Promise<void> {
    for (let i = 0; i < ids.length; i += PAGE) {
      const refs = ids.slice(i, i + PAGE).map((id) => db.collection(collection).doc(id));
      for (const snap of await db.getAll(...refs, { fieldMask })) {
        if (snap.exists) each(snap.id, snap.data() as T);
      }
    }
  }

  return {
    async listGameObjects(): Promise<StoredObject[]> {
      const out: StoredObject[] = [];
      let pageToken: string | undefined;
      do {
        const [files, next] = await bucket.getFiles({
          prefix: "games/",
          autoPaginate: false,
          maxResults: LIST_PAGE,
          pageToken,
        });
        for (const file of files) {
          out.push({ name: file.name, createdMs: Date.parse(String(file.metadata.timeCreated ?? "")) || Date.now() });
        }
        // The SDK returns a null next page on the last one, despite its type.
        pageToken = (next as typeof next | null)?.pageToken;
      } while (pageToken);
      return out;
    },
    async forEachDoc(collection, fields, visit): Promise<void> {
      const base = db
        .collection(collection)
        .select(...fields)
        .orderBy("__name__")
        .limit(PAGE);
      let query = base;
      for (;;) {
        const snap = await query.get();
        for (const doc of snap.docs) visit(doc.data());
        if (snap.size < PAGE) return;
        query = base.startAfter(snap.docs[snap.docs.length - 1]);
      }
    },
    async readGames(gameIds): Promise<Map<string, GameDoc>> {
      const games = new Map<string, GameDoc>();
      await getAllIn<GameDoc>("games", gameIds, ["status", "currentTrickVideoUrl", "matchVideoUrl"], (id, data) =>
        games.set(id, data),
      );
      return games;
    },
    async existingClipIds(clipIds): Promise<Set<string>> {
      const found = new Set<string>();
      await getAllIn("clips", clipIds, ["videoUrl"], (id) => found.add(id));
      return found;
    },
    async deleteObject(name): Promise<void> {
      await bucket.file(name).delete({ ignoreNotFound: true });
    },
  };
}
