/**
 * What's That Trick (WTT) service layer.
 * Read open items, submit votes, track reliability.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Timestamp,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { requireDb } from "../firebase";
import type { ProReview, WttChoice, WttItem, WttReliability, WttVote } from "./wtt.types";
import { logger } from "./logger";
import { errorLogFields } from "../utils/errors";

const WTT_ITEMS_COLLECTION = "wttItems";
const WTT_VOTES_COLLECTION = "wttVotes";
const PRO_REVIEWS_COLLECTION = "proReviews";

/**
 * Fetch a batch of open WTT items for the Name It feed.
 * Returns items the user hasn't voted on yet.
 */
export async function fetchWttItems(uid: string, batchSize: number = 20): Promise<WttItem[]> {
  const db = requireDb();
  const q = query(
    collection(db, WTT_ITEMS_COLLECTION),
    where("status", "==", "open"),
    orderBy("createdAt", "desc"),
    limit(batchSize),
  );

  const snapshot = await getDocs(q);
  const items: WttItem[] = [];

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const voteId = `${docSnap.id}_${uid}`;
    const voteDoc = await getDoc(doc(db, WTT_VOTES_COLLECTION, voteId));

    if (!voteDoc.exists()) {
      items.push({
        clipId: docSnap.id,
        trickFamily: data.trickFamily,
        options: data.options as [string, string, string, string],
        aliases: data.aliases,
        status: data.status,
        voteCount: data.voteCount ?? 0,
        weightedTally: data.weightedTally ?? {},
        top: data.top ?? null,
        topPosterior: data.topPosterior ?? 0,
        createdAt: (data.createdAt as Timestamp).toDate(),
        retiredAt: data.retiredAt ? (data.retiredAt as Timestamp).toDate() : undefined,
      });
    }
  }

  return items;
}

/**
 * Submit a WTT vote. One vote per user per clip.
 * Server function will validate and update tallies.
 */
export async function submitWttVote(clipId: string, uid: string, choice: WttChoice): Promise<void> {
  const db = requireDb();
  const voteId = `${clipId}_${uid}`;
  const voteDoc: WttVote = {
    clipId,
    uid,
    choice,
    createdAt: new Date(),
  };

  await setDoc(doc(db, WTT_VOTES_COLLECTION, voteId), {
    clipId: voteDoc.clipId,
    uid: voteDoc.uid,
    choice: voteDoc.choice,
    createdAt: serverTimestamp(),
  });
}

/**
 * Fetch user's WTT reliability stats and streak.
 */
export async function fetchWttReliability(uid: string): Promise<WttReliability | null> {
  const db = requireDb();
  const docRef = doc(db, `users/${uid}/private/wtt`);
  const docSnap = await getDoc(docRef);

  if (!docSnap.exists()) {
    return null;
  }

  const data = docSnap.data();
  return {
    reliability: data.reliability ?? {},
    goldSeen: data.goldSeen ?? 0,
    goldCorrect: data.goldCorrect ?? 0,
    trickIq: data.trickIq ?? 0,
    streakDays: data.streakDays ?? 0,
    lastAnsweredDay: data.lastAnsweredDay ?? null,
    freezesLeft: data.freezesLeft ?? 1,
  };
}

/**
 * Subscribe to WTT reliability updates.
 */
export function subscribeToWttReliability(
  uid: string,
  callback: (reliability: WttReliability | null) => void,
): Unsubscribe {
  const db = requireDb();
  const docRef = doc(db, `users/${uid}/private/wtt`);

  return onSnapshot(
    docRef,
    (docSnap) => {
      if (!docSnap.exists()) {
        callback(null);
        return;
      }

      const data = docSnap.data();
      callback({
        reliability: data.reliability ?? {},
        goldSeen: data.goldSeen ?? 0,
        goldCorrect: data.goldCorrect ?? 0,
        trickIq: data.trickIq ?? 0,
        streakDays: data.streakDays ?? 0,
        lastAnsweredDay: data.lastAnsweredDay ?? null,
        freezesLeft: data.freezesLeft ?? 1,
      });
    },
    (error) => {
      logger.error("wtt_reliability_subscribe_failed", errorLogFields(error));
      callback(null);
    },
  );
}

/**
 * Submit a pro review for a disputed clip (verified pros only).
 */
export async function submitProReview(
  clipId: string,
  uid: string,
  answerTrickId: string,
  note?: string,
): Promise<void> {
  const db = requireDb();
  const reviewDoc: ProReview = {
    clipId,
    uid,
    answerTrickId,
    note,
    createdAt: new Date(),
  };

  await setDoc(doc(db, PRO_REVIEWS_COLLECTION, `${clipId}_${uid}`), {
    clipId: reviewDoc.clipId,
    uid: reviewDoc.uid,
    answerTrickId: reviewDoc.answerTrickId,
    ...(note && { note }),
    createdAt: serverTimestamp(),
  });
}
