#!/usr/bin/env node
/**
 * One-time XP backfill. Replays terminal games through the four XP rules and
 * SETs xp and level. Does not increment.
 *
 * Run it while XP_ENABLED is still false, and pass --exclude for tester uids
 * so a live tester total is not replaced by history. Historical votes and
 * clips unlock achievements. They do not add XP.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json
 *   node scripts/backfill-xp.mjs --dry-run
 *   node scripts/backfill-xp.mjs --exclude=uid1,uid2
 *   node scripts/backfill-xp.mjs
 *
 * The numbers match functions/src/applyGameStats.ts and src/constants/xp.ts.
 * A dry-run checksum, not the writer, is gamesPlayed×50 + wins×50 + tricksLanded×10.
 * It ignores forfeits and the pair taper, so a large gap is worth a look.
 * The last quiet run wins.
 */
import { readFileSync } from "node:fs";
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const FIRESTORE_DB_ID = "skatehubba";
const BATCH_SIZE = 400;
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_CAP = 3000;

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const excludeArg = args.find((arg) => arg.startsWith("--exclude="));
const EXCLUDE = new Set(
  (excludeArg ? excludeArg.slice("--exclude=".length) : "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0),
);

export function levelForXp(xp) {
  const safe = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  let level = 1;
  for (let steps = 1; steps < 50; steps += 1) {
    if (24 * steps * steps <= safe) level = steps + 1;
    else break;
  }
  return level;
}

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function toMillis(raw) {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (raw instanceof Date) return raw.getTime();
  if (raw && typeof raw.toMillis === "function") {
    const ms = raw.toMillis();
    return typeof ms === "number" && Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function pairMultiplier(prior) {
  if (prior <= 0) return 1;
  if (prior === 1) return 0.5;
  if (prior === 2) return 0.25;
  return 0;
}

const GRANTS = [
  ["games_10", "gamesPlayed", 10, "Finish 10 games."],
  ["games_50", "gamesPlayed", 50, "Finish 50 games."],
  ["games_250", "gamesPlayed", 250, "Finish 250 games."],
  ["wins_10", "wins", 10, "Win 10 games."],
  ["wins_100", "wins", 100, "Win 100 games."],
  ["wins_500", "wins", 500, "Win 500 games."],
  ["streak_3", "bestWinStreak", 3, "Win 3 games in a row."],
  ["streak_5", "bestWinStreak", 5, "Win 5 games in a row."],
  ["streak_10", "bestWinStreak", 10, "Win 10 games in a row."],
  ["lands_50", "tricksLanded", 50, "Land 50 tricks."],
  ["lands_250", "tricksLanded", 250, "Land 250 tricks."],
  ["lands_1000", "tricksLanded", 1000, "Land 1,000 tricks."],
  ["shutout_1", "cleanWins", 1, "Win a game without taking a letter."],
  ["shutout_10", "cleanWins", 10, "Win 10 games without taking a letter."],
  ["shutout_25", "cleanWins", 25, "Win 25 games without taking a letter."],
  ["comeback_1", "comebackWins", 1, "Win after falling to S.K.A.T."],
  ["comeback_5", "comebackWins", 5, "Win 5 games after falling to S.K.A.T."],
  ["comeback_20", "comebackWins", 20, "Win 20 games after falling to S.K.A.T."],
  ["whistle_1", "turnsJudged", 1, "Rule 1 turn."],
  ["whistle_25", "turnsJudged", 25, "Rule 25 turns."],
  ["whistle_100", "turnsJudged", 100, "Rule 100 turns."],
  ["votes_1", "disputeVotesCast", 1, "Cast 1 vote that stood."],
  ["votes_25", "disputeVotesCast", 25, "Cast 25 votes that stood."],
  ["votes_100", "disputeVotesCast", 100, "Cast 100 votes that stood."],
  ["opponents_5", "uniqueOpponents", 5, "Skate 5 different people."],
  ["opponents_25", "uniqueOpponents", 25, "Skate 25 different people."],
  ["opponents_100", "uniqueOpponents", 100, "Skate 100 different people."],
  ["spots_1", "spotsPlayed", 1, "Finish a game at 1 spot."],
  ["spots_5", "spotsPlayed", 5, "Finish a game at 5 spots."],
  ["spots_20", "spotsPlayed", 20, "Finish a game at 20 spots."],
  ["homespot_1", "gamesAtMySpots", 1, "Finish 1 game at a spot you created."],
  ["homespot_10", "gamesAtMySpots", 10, "Finish 10 games at a spot you created."],
  ["homespot_50", "gamesAtMySpots", 50, "Finish 50 games at a spot you created."],
  ["clips_1", "clipsPosted", 1, "Post 1 clip."],
  ["clips_10", "clipsPosted", 10, "Post 10 clips."],
  ["clips_50", "clipsPosted", 50, "Post 50 clips."],
];

function blank(uid) {
  return {
    uid,
    createdAt: null,
    xp: 0,
    xpDay: null,
    xpToday: 0,
    gamesPlayed: 0,
    wins: 0,
    currentStreak: 0,
    bestWinStreak: 0,
    tricksLanded: 0,
    cleanWins: 0,
    comebackWins: 0,
    turnsJudged: 0,
    disputeVotesCast: 0,
    clipsPosted: 0,
    uniqueOpponents: 0,
    spotsPlayed: 0,
    gamesAtMySpots: 0,
    opps: new Set(),
    spots: new Set(),
    storedGamesPlayed: 0,
    storedWins: 0,
    storedLands: 0,
    achievements: new Map(),
    exists: false,
  };
}

function keep(user, award, day) {
  if (award <= 0 || day === null) {
    if (award > 0 && day === null) user.xp += award;
    return;
  }
  const used = user.xpDay === day ? user.xpToday : 0;
  const kept = Math.min(award, Math.max(0, DAILY_CAP - used));
  if (kept <= 0) return;
  user.xp += kept;
  user.xpDay = day;
  user.xpToday = used + kept;
}

function noteGrant(user, atMs) {
  const counters = {
    gamesPlayed: user.gamesPlayed,
    wins: user.wins,
    bestWinStreak: user.bestWinStreak,
    tricksLanded: user.tricksLanded,
    cleanWins: user.cleanWins,
    comebackWins: user.comebackWins,
    turnsJudged: user.turnsJudged,
    disputeVotesCast: user.disputeVotesCast,
    uniqueOpponents: user.uniqueOpponents,
    spotsPlayed: user.spotsPlayed,
    gamesAtMySpots: user.gamesAtMySpots,
    clipsPosted: user.clipsPosted,
  };
  for (const [id, field, threshold] of GRANTS) {
    if (counters[field] >= threshold && !user.achievements.has(id)) {
      user.achievements.set(id, atMs);
    }
  }
}

/**
 * Replay terminal games in updatedAt order. Mutates `users` and `pairs`.
 * `users` is a Map of uid -> blank(). `spots` is spotId -> createdBy.
 */
export function replayGames(games, users, spots) {
  const pairs = new Map();
  const ordered = [...games].sort((a, b) => (toMillis(a.updatedAt) ?? 0) - (toMillis(b.updatedAt) ?? 0));
  for (const game of ordered) {
    const p1 = game.player1Uid;
    const p2 = game.player2Uid;
    const winner = game.winner;
    if (typeof winner !== "string" || (winner !== p1 && winner !== p2)) continue;
    if (typeof p1 !== "string" || typeof p2 !== "string") continue;
    const loser = winner === p1 ? p2 : p1;
    const history = Array.isArray(game.turnHistory) ? game.turnHistory : [];
    const empty = game.status === "forfeit" && history.length < 2;
    const dayMs = toMillis(game.updatedAt) ?? toMillis(game.createdAt);
    const day = dayMs === null ? null : utcDay(dayMs);
    const winnerUser = users.get(winner) ?? blank(winner);
    const loserUser = users.get(loser) ?? blank(loser);
    users.set(winner, winnerUser);
    users.set(loser, loserUser);

    const lands = { [winner]: 0, [loser]: 0 };
    const letters = { [winner]: 0, [loser]: 0 };
    const peak = { [winner]: 0, [loser]: 0 };
    const judged = {};
    for (const entry of history) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.judgedBy === "string" && entry.judgedBy.length > 0) {
        judged[entry.judgedBy] = (judged[entry.judgedBy] ?? 0) + 1;
      }
      if (entry.matcherUid === winner || entry.matcherUid === loser) {
        if (entry.landed === true) lands[entry.matcherUid] += 1;
      }
      if (entry.landed === false && (entry.letterTo === winner || entry.letterTo === loser)) {
        letters[entry.letterTo] += 1;
        peak[entry.letterTo] = Math.max(peak[entry.letterTo], letters[entry.letterTo]);
      }
    }

    const gameCreated = toMillis(game.createdAt);
    const oldEnough =
      gameCreated !== null &&
      winnerUser.createdAt !== null &&
      loserUser.createdAt !== null &&
      gameCreated - winnerUser.createdAt >= DAY_MS &&
      gameCreated - loserUser.createdAt >= DAY_MS;

    let multiplier = 1;
    if (!empty && day !== null) {
      const pairId = [winner, loser].sort().join("_");
      const prior = pairs.get(pairId);
      const count = prior && prior.day === day ? prior.count : 0;
      multiplier = pairMultiplier(count);
      pairs.set(pairId, { day, count: count + 1 });
    }
    if (empty) multiplier = 0;

    const play = (isWinner, uid) => {
      if (empty || !oldEnough) return 0;
      const win = game.status === "complete" && isWinner ? 50 : 0;
      return Math.floor((50 + win + lands[uid] * 10) * multiplier);
    };

    winnerUser.gamesPlayed += 1;
    loserUser.gamesPlayed += 1;
    winnerUser.wins += 1;
    winnerUser.currentStreak += 1;
    winnerUser.bestWinStreak = Math.max(winnerUser.bestWinStreak, winnerUser.currentStreak);
    loserUser.currentStreak = 0;
    winnerUser.tricksLanded += lands[winner];
    loserUser.tricksLanded += lands[loser];
    if (letters[winner] === 0) winnerUser.cleanWins += 1;
    if (peak[winner] >= 4) winnerUser.comebackWins += 1;

    if (!empty) {
      if (!winnerUser.opps.has(loser)) {
        winnerUser.opps.add(loser);
        winnerUser.uniqueOpponents += 1;
      }
      if (!loserUser.opps.has(winner)) {
        loserUser.opps.add(winner);
        loserUser.uniqueOpponents += 1;
      }
      const spotId = typeof game.spotId === "string" && game.spotId.length > 0 ? game.spotId : null;
      if (spotId) {
        for (const user of [winnerUser, loserUser]) {
          if (!user.spots.has(spotId)) {
            user.spots.add(spotId);
            user.spotsPlayed += 1;
          }
          if (spots.get(spotId) === user.uid) user.gamesAtMySpots += 1;
        }
      }
    }

    keep(winnerUser, play(true, winner), day);
    keep(loserUser, play(false, loser), day);

    const judge = game.judgeStatus === "accepted" && typeof game.judgeId === "string" ? game.judgeId : null;
    if (judge && !empty) {
      const turns = judged[judge] ?? 0;
      const judgeUser = users.get(judge) ?? blank(judge);
      users.set(judge, judgeUser);
      judgeUser.turnsJudged += turns;
      keep(judgeUser, turns * 10, day);
      noteGrant(judgeUser, dayMs ?? 0);
    }
    noteGrant(winnerUser, dayMs ?? 0);
    noteGrant(loserUser, dayMs ?? 0);
  }
}

function initAdmin() {
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath) {
    initializeApp({ credential: cert(JSON.parse(readFileSync(credPath, "utf-8"))) });
  } else {
    initializeApp();
  }
  return getFirestore(FIRESTORE_DB_ID);
}

async function main() {
  const db = initAdmin();
  const [gamesSnap, usersSnap, spotsSnap, votesSnap, clipsSnap, achSnap] = await Promise.all([
    db.collection("games").where("status", "in", ["complete", "forfeit"]).get(),
    db.collection("users").get(),
    db.collection("spots").get(),
    db.collection("disputeVotes").get(),
    db.collection("clips").where("source", "==", "user").get(),
    db.collectionGroup("achievements").get(),
  ]);

  const users = new Map();
  for (const doc of usersSnap.docs) {
    const data = doc.data();
    const user = blank(doc.id);
    user.exists = true;
    user.createdAt = toMillis(data.createdAt);
    user.storedGamesPlayed = typeof data.gamesPlayed === "number" ? data.gamesPlayed : 0;
    user.storedWins = typeof data.wins === "number" ? data.wins : 0;
    user.storedLands = typeof data.tricksLanded === "number" ? data.tricksLanded : 0;
    users.set(doc.id, user);
  }
  const spots = new Map();
  for (const doc of spotsSnap.docs) {
    const createdBy = doc.data().createdBy;
    if (typeof createdBy === "string") spots.set(doc.id, createdBy);
  }

  const games = gamesSnap.docs.map((doc) => doc.data());
  replayGames(games, users, spots);

  for (const doc of votesSnap.docs) {
    const uid = doc.data().uid;
    if (typeof uid !== "string" || !users.has(uid)) continue;
    const user = users.get(uid);
    user.disputeVotesCast += 1;
    noteGrant(user, toMillis(doc.data().createdAt) ?? 0);
  }
  for (const doc of clipsSnap.docs) {
    const uid = doc.data().playerUid;
    if (typeof uid !== "string" || !users.has(uid)) continue;
    const user = users.get(uid);
    user.clipsPosted += 1;
    noteGrant(user, toMillis(doc.data().createdAt) ?? 0);
  }

  const existingAch = new Set(achSnap.docs.map((doc) => doc.ref.path));
  let batch = db.batch();
  let ops = 0;
  let writtenUsers = 0;
  let writtenAchievements = 0;

  async function queue(ref, data, merge) {
    if (DRY_RUN) return;
    batch.set(ref, data, { merge: merge === true });
    ops += 1;
    if (ops >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      ops = 0;
    }
  }

  for (const user of users.values()) {
    if (!user.exists || EXCLUDE.has(user.uid)) continue;
    const checksum = user.storedGamesPlayed * 50 + user.storedWins * 50 + user.storedLands * 10;
    console.log(
      `USER ${user.uid} xp=${user.xp} level=${levelForXp(user.xp)} checksum=${checksum} gap=${user.xp - checksum}`,
    );
    await queue(
      db.collection("users").doc(user.uid),
      {
        xp: user.xp,
        level: levelForXp(user.xp),
        ...(user.xpDay ? { xpDay: user.xpDay, xpToday: user.xpToday } : {}),
        uniqueOpponents: user.uniqueOpponents,
        spotsPlayed: user.spotsPlayed,
        gamesAtMySpots: user.gamesAtMySpots,
        disputeVotesCast: user.disputeVotesCast,
        clipsPosted: user.clipsPosted,
      },
      true,
    );
    writtenUsers += 1;
    for (const [id, atMs] of user.achievements) {
      const path = `users/${user.uid}/achievements/${id}`;
      if (existingAch.has(path)) continue;
      const grant = GRANTS.find((row) => row[0] === id);
      await queue(
        db.collection("users").doc(user.uid).collection("achievements").doc(id),
        {
          earnedAt: atMs > 0 ? new Date(atMs) : FieldValue.serverTimestamp(),
          reason: grant ? grant[3] : id,
        },
        false,
      );
      writtenAchievements += 1;
    }
  }

  if (!DRY_RUN && ops > 0) await batch.commit();
  console.log(
    `DONE dryRun=${DRY_RUN} users=${writtenUsers} achievements=${writtenAchievements} excluded=${EXCLUDE.size} games=${games.length}`,
  );
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("backfill-xp.mjs");
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
