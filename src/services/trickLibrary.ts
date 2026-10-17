/**
 * Trick Library service — community trick index.
 *
 * Submissions go to `trickLibrary/{trickId}` with status "pending".
 * Moderators approve/reject. Users can upvote/downvote approved entries.
 */
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb, requireAuth } from "../firebase";
import type { TrickLibraryEntry, TrickVote, TrickDifficulty } from "../types/trickLibrary";

const TRICKS_COLLECTION = "trickLibrary";
const VOTES_COLLECTION = "trickVotes";

export async function submitTrick(
  name: string,
  description: string | undefined,
  difficulty: TrickDifficulty,
  videoUrl: string,
  thumbnailUrl: string | undefined,
): Promise<string> {
  const auth = requireAuth();
  const db = requireDb();
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to submit a trick.");

  const trickRef = doc(collection(db, TRICKS_COLLECTION));
  const trickId = trickRef.id;

  const entry: Omit<TrickLibraryEntry, "uid"> = {
    name: name.trim(),
    description: description?.trim(),
    difficulty,
    videoUrl,
    videoThumbnailUrl: thumbnailUrl,
    submittedBy: user.uid,
    submittedAt: Date.now(),
    upvotes: 0,
    downvotes: 0,
    status: "pending",
  };

  await setDoc(trickRef, entry);
  return trickId;
}

export async function getTrick(trickId: string): Promise<TrickLibraryEntry | null> {
  const db = requireDb();
  const snap = await getDoc(doc(db, TRICKS_COLLECTION, trickId));
  if (!snap.exists()) return null;
  return { uid: snap.id, ...snap.data() } as TrickLibraryEntry;
}

export async function listApprovedTricks(maxResults = 50): Promise<TrickLibraryEntry[]> {
  const db = requireDb();
  const q = query(
    collection(db, TRICKS_COLLECTION),
    where("status", "==", "approved"),
    orderBy("upvotes", "desc"),
    limit(maxResults),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as TrickLibraryEntry);
}

export async function listPendingTricks(maxResults = 50): Promise<TrickLibraryEntry[]> {
  const auth = requireAuth();
  const db = requireDb();
  const user = auth.currentUser;
  if (!user) return [];

  const q = query(
    collection(db, TRICKS_COLLECTION),
    where("status", "==", "pending"),
    orderBy("submittedAt", "desc"),
    limit(maxResults),
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as TrickLibraryEntry);
}

export function subscribeToApprovedTricks(
  callback: (tricks: TrickLibraryEntry[]) => void,
  maxResults = 50,
): Unsubscribe {
  const db = requireDb();
  const q = query(
    collection(db, TRICKS_COLLECTION),
    where("status", "==", "approved"),
    orderBy("upvotes", "desc"),
    limit(maxResults),
  );
  return onSnapshot(q, (snap) => {
    const tricks = snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as TrickLibraryEntry);
    callback(tricks);
  });
}

export async function voteTrick(trickId: string, vote: "up" | "down"): Promise<void> {
  const auth = requireAuth();
  const db = requireDb();
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to vote.");

  const voteId = `${user.uid}_${trickId}`;
  const voteRef = doc(db, VOTES_COLLECTION, voteId);
  const voteDoc: Omit<TrickVote, "uid"> = {
    trickId,
    userId: user.uid,
    vote,
    createdAt: Date.now(),
  };

  await setDoc(voteRef, voteDoc);
}

export async function getUserVote(trickId: string): Promise<"up" | "down" | null> {
  const auth = requireAuth();
  const db = requireDb();
  const user = auth.currentUser;
  if (!user) return null;

  const voteId = `${user.uid}_${trickId}`;
  const snap = await getDoc(doc(db, VOTES_COLLECTION, voteId));
  if (!snap.exists()) return null;
  return snap.data().vote as "up" | "down";
}

export async function approveTrick(trickId: string): Promise<void> {
  const auth = requireAuth();
  const db = requireDb();
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to moderate tricks.");

  const trickRef = doc(db, TRICKS_COLLECTION, trickId);
  await setDoc(
    trickRef,
    {
      status: "approved",
      moderatedBy: user.uid,
      moderatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

export async function rejectTrick(trickId: string): Promise<void> {
  const auth = requireAuth();
  const db = requireDb();
  const user = auth.currentUser;
  if (!user) throw new Error("You must be signed in to moderate tricks.");

  const trickRef = doc(db, TRICKS_COLLECTION, trickId);
  await setDoc(
    trickRef,
    {
      status: "rejected",
      moderatedBy: user.uid,
      moderatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
