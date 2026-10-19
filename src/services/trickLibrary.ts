/**
 * Trick Library service: community trick index (flag VITE_FEATURE_TRICK_LIBRARY_ENABLED).
 *
 * trickLibrary/{id}: submitted as "pending"; only an admin-claim holder can
 * approve or reject (firestore.rules). trickVotes/{uid}_{trickId}: one vote
 * per user per approved trick. Scores are count queries over the votes, so no
 * client writes a counter.
 */
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import {
  TRICK_DESCRIPTION_MAX,
  TRICK_DIFFICULTIES,
  TRICK_NAME_MAX,
  type TrickDifficulty,
  type TrickLibraryEntry,
  type TrickScore,
  type TrickStatus,
  type TrickVoteValue,
} from "../types/trickLibrary";

const TRICKS = "trickLibrary";
const VOTES = "trickVotes";
const LIST_LIMIT = 100;

export interface TrickSubmission {
  name: string;
  difficulty: TrickDifficulty;
  description?: string;
  videoUrl?: string;
}

function toMillis(value: unknown): number {
  if (typeof value === "number") return value;
  if (value && typeof (value as { toMillis?: unknown }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return 0;
}

function toEntry(snap: QueryDocumentSnapshot<DocumentData>): TrickLibraryEntry {
  const d = snap.data();
  const entry: TrickLibraryEntry = {
    id: snap.id,
    name: String(d.name ?? ""),
    difficulty: d.difficulty as TrickDifficulty,
    submittedBy: String(d.submittedBy ?? ""),
    submittedAt: toMillis(d.submittedAt),
    status: d.status as TrickStatus,
  };
  if (typeof d.description === "string") entry.description = d.description;
  if (typeof d.videoUrl === "string") entry.videoUrl = d.videoUrl;
  return entry;
}

/** Newest first; a pending server timestamp (0) sorts as newest. */
function newestFirst(list: TrickLibraryEntry[]): TrickLibraryEntry[] {
  return [...list].sort((a, b) => (b.submittedAt || Infinity) - (a.submittedAt || Infinity));
}

/** Validate and normalise a submission. Throws a plain-English error. */
export function cleanSubmission(input: TrickSubmission): TrickSubmission {
  const name = input.name.trim();
  if (!name) throw new Error("Give the trick a name.");
  if (name.length > TRICK_NAME_MAX) throw new Error(`Keep the name under ${TRICK_NAME_MAX} characters.`);
  if (!TRICK_DIFFICULTIES.includes(input.difficulty)) throw new Error("Pick a difficulty.");
  const out: TrickSubmission = { name, difficulty: input.difficulty };
  const description = input.description?.trim();
  if (description) {
    if (description.length > TRICK_DESCRIPTION_MAX) {
      throw new Error(`Keep the description under ${TRICK_DESCRIPTION_MAX} characters.`);
    }
    out.description = description;
  }
  if (input.videoUrl) out.videoUrl = input.videoUrl;
  return out;
}

/** Submit a trick for review. Returns the new doc id. */
export async function submitTrick(uid: string, input: TrickSubmission): Promise<string> {
  const clean = cleanSubmission(input);
  const ref = await addDoc(collection(requireDb(), TRICKS), {
    ...clean,
    submittedBy: uid,
    submittedAt: serverTimestamp(),
    status: "pending",
  });
  return ref.id;
}

/** Approved tricks, newest first. */
export async function listApprovedTricks(): Promise<TrickLibraryEntry[]> {
  const q = query(collection(requireDb(), TRICKS), where("status", "==", "approved"), limit(LIST_LIMIT));
  const snap = await getDocs(q);
  return newestFirst(snap.docs.map(toEntry));
}

/** Everything this user submitted, any status, newest first. */
export async function listMySubmissions(uid: string): Promise<TrickLibraryEntry[]> {
  const q = query(collection(requireDb(), TRICKS), where("submittedBy", "==", uid), limit(LIST_LIMIT));
  const snap = await getDocs(q);
  return newestFirst(snap.docs.map(toEntry));
}

/** Review queue. Rules only let admin-claim holders run this. */
export async function listPendingTricks(): Promise<TrickLibraryEntry[]> {
  const q = query(collection(requireDb(), TRICKS), where("status", "==", "pending"), limit(LIST_LIMIT));
  const snap = await getDocs(q);
  return newestFirst(snap.docs.map(toEntry));
}

/** Admin decision on a pending trick. */
export async function moderateTrick(
  adminUid: string,
  trickId: string,
  decision: "approved" | "rejected",
): Promise<void> {
  await updateDoc(doc(requireDb(), TRICKS, trickId), {
    status: decision,
    moderatedBy: adminUid,
    moderatedAt: serverTimestamp(),
  });
}

function voteRef(uid: string, trickId: string) {
  return doc(requireDb(), VOTES, `${uid}_${trickId}`);
}

/** Cast or change this user's vote on an approved trick. */
export async function voteTrick(uid: string, trickId: string, vote: TrickVoteValue): Promise<void> {
  await setDoc(voteRef(uid, trickId), { trickId, userId: uid, vote, createdAt: serverTimestamp() });
}

/** Take this user's vote back. */
export async function clearTrickVote(uid: string, trickId: string): Promise<void> {
  await deleteDoc(voteRef(uid, trickId));
}

/** This user's current vote, or null. */
export async function getMyTrickVote(uid: string, trickId: string): Promise<TrickVoteValue | null> {
  const snap = await getDoc(voteRef(uid, trickId));
  if (!snap.exists()) return null;
  const vote = snap.data().vote;
  return vote === "up" || vote === "down" ? vote : null;
}

/** Up and down counts for one trick. */
export async function getTrickScore(trickId: string): Promise<TrickScore> {
  const votes = collection(requireDb(), VOTES);
  const [up, down] = await Promise.all([
    getCountFromServer(query(votes, where("trickId", "==", trickId), where("vote", "==", "up"))),
    getCountFromServer(query(votes, where("trickId", "==", trickId), where("vote", "==", "down"))),
  ]);
  return { up: up.data().count, down: down.data().count };
}
