import type { Mock } from "vitest";

/**
 * The firebase/firestore surface profileCustom reads and writes, faked with
 * path strings: `doc(db, "clips", id)` is "clips/<id>", a query is its
 * constraint list. Shared by the service test and the pin-cleanup test.
 */
export function fakeProfileCustomFirestore(h: { getDoc: Mock; getDocs: Mock; setDoc: Mock }) {
  return {
    doc: (_db: unknown, ...p: string[]) => p.join("/"),
    collection: (_db: unknown, ...p: string[]) => p.join("/"),
    where: (...a: unknown[]) => ({ where: a }),
    limit: (n: number) => ({ limit: n }),
    query: (...a: unknown[]) => a,
    getDoc: h.getDoc,
    getDocs: h.getDocs,
    setDoc: h.setDoc,
    serverTimestamp: () => "TS",
  };
}
