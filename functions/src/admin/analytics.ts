/**
 * Admin analytics callable (`adminAnalytics`). Admin claim only: pros and
 * players get permission-denied. Counts use server-side aggregation; daily
 * players and retention scan recent games (capped) for distinct players.
 */
import { HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

const DAY = 24 * 60 * 60 * 1000;
export const GAME_SCAN_LIMIT = 2000;
export const COHORT_LIMIT = 500;

export interface AnalyticsSnapshot {
  dailyPlayers: number;
  weeklyPlayers: number;
  newPlayers7d: number;
  gamesStarted7d: number;
  gamesFinished7d: number;
  clipsPosted7d: number;
  retention: { cohort: number; returned: number };
  generatedAtMs: number;
}

async function count(q: FirebaseFirestore.Query): Promise<number> {
  const snap = await q.count().get();
  return snap.data().count;
}

function playersOf(data: Record<string, unknown>): string[] {
  return [data.player1Uid, data.player2Uid].filter((u): u is string => typeof u === "string" && u.length > 0);
}

export async function computeAnalytics(db: Firestore, nowMs: number): Promise<AnalyticsSnapshot> {
  const ts = (ms: number) => Timestamp.fromMillis(ms);
  const weekAgo = ts(nowMs - 7 * DAY);
  const games = db.collection("games");
  const [newPlayers7d, gamesStarted7d, clipsPosted7d, recent, cohortSnap] = await Promise.all([
    count(db.collection("users").where("createdAt", ">=", weekAgo)),
    count(games.where("createdAt", ">=", weekAgo)),
    count(db.collection("clips").where("createdAt", ">=", weekAgo)),
    games.where("updatedAt", ">=", weekAgo).limit(GAME_SCAN_LIMIT).get(),
    db
      .collection("users")
      .where("createdAt", ">=", ts(nowMs - 14 * DAY))
      .where("createdAt", "<", weekAgo)
      .limit(COHORT_LIMIT)
      .get(),
  ]);
  const daily = new Set<string>();
  const weekly = new Set<string>();
  const dayAgoMs = nowMs - DAY;
  let gamesFinished7d = 0;
  for (const d of recent.docs) {
    const data = d.data();
    if (data.status === "complete" || data.status === "forfeit") gamesFinished7d++;
    const updated = data.updatedAt as { toMillis?: () => number } | undefined;
    const players = playersOf(data);
    players.forEach((p) => weekly.add(p));
    if (typeof updated?.toMillis === "function" && updated.toMillis() >= dayAgoMs) players.forEach((p) => daily.add(p));
  }
  const cohort = cohortSnap.docs.map((d) => d.id);
  return {
    dailyPlayers: daily.size,
    weeklyPlayers: weekly.size,
    newPlayers7d,
    gamesStarted7d,
    gamesFinished7d,
    clipsPosted7d,
    retention: { cohort: cohort.length, returned: cohort.filter((u) => weekly.has(u)).length },
    generatedAtMs: nowMs,
  };
}

export async function handleAnalyticsCall(
  request: Pick<CallableRequest, "auth">,
  db: Firestore,
  nowMs: number,
): Promise<AnalyticsSnapshot> {
  if (!request.auth?.uid) throw new HttpsError("unauthenticated", "unauthenticated");
  if (request.auth.token?.admin !== true) throw new HttpsError("permission-denied", "not_admin");
  return computeAnalytics(db, nowMs);
}
