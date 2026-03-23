import pool from "../db/pool.js";
import type { GameRow, TurnHistoryRow } from "../types/models.js";

const TURN_DEADLINE_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_GAME_CREATE_MS = 30_000; // 30 seconds
const RATE_LIMIT_TURN_ACTION_MS = 2_000; // 2 seconds

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deadlineFromNow(): Date {
  return new Date(Date.now() + TURN_DEADLINE_MS);
}

function assertPlayer(game: GameRow, uid: string): void {
  if (game.player1_uid !== uid && game.player2_uid !== uid) {
    throw new GameError(403, "Not a player in this game");
  }
}

function assertCurrentTurn(game: GameRow, uid: string): void {
  if (game.current_turn !== uid) {
    throw new GameError(403, "Not your turn");
  }
}

function assertActive(game: GameRow): void {
  if (game.status !== "active") {
    throw new GameError(409, "Game is not active");
  }
}

function opponent(game: GameRow, uid: string): string {
  return game.player1_uid === uid ? game.player2_uid : game.player1_uid;
}

export class GameError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export async function getGame(gameId: string, uid: string): Promise<GameRow & { turn_history: TurnHistoryRow[] }> {
  const { rows } = await pool.query<GameRow>(`SELECT * FROM games WHERE id = $1`, [gameId]);
  const game = rows[0];
  if (!game) throw new GameError(404, "Game not found");
  assertPlayer(game, uid);

  const history = await pool.query<TurnHistoryRow>(
    `SELECT * FROM turn_history WHERE game_id = $1 ORDER BY turn_number`,
    [gameId],
  );
  return { ...game, turn_history: history.rows };
}

export async function getMyGames(uid: string, limit = 20): Promise<GameRow[]> {
  const { rows } = await pool.query<GameRow>(
    `SELECT * FROM games
     WHERE player1_uid = $1 OR player2_uid = $1
     ORDER BY
       CASE WHEN status = 'active' THEN 0 ELSE 1 END,
       turn_number DESC
     LIMIT $2`,
    [uid, limit],
  );
  return rows;
}

// ---------------------------------------------------------------------------
// Mutations (all transactional)
// ---------------------------------------------------------------------------

export async function createGame(
  challengerUid: string,
  challengerUsername: string,
  opponentUid: string,
  opponentUsername: string,
): Promise<GameRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Rate limit: check user's last game creation
    const { rows: userRows } = await client.query<{
      last_game_created_at: Date | null;
    }>(`SELECT last_game_created_at FROM users WHERE uid = $1 FOR UPDATE`, [challengerUid]);
    const lastCreated = userRows[0]?.last_game_created_at;
    if (lastCreated && Date.now() - lastCreated.getTime() < RATE_LIMIT_GAME_CREATE_MS) {
      throw new GameError(429, "Please wait before creating another game");
    }

    const deadline = deadlineFromNow();

    const { rows } = await client.query<GameRow>(
      `INSERT INTO games
         (player1_uid, player2_uid, player1_username, player2_username,
          current_turn, current_setter, turn_deadline)
       VALUES ($1, $2, $3, $4, $1, $1, $5)
       RETURNING *`,
      [challengerUid, opponentUid, challengerUsername, opponentUsername, deadline],
    );

    // Update rate limit timestamp
    await client.query(`UPDATE users SET last_game_created_at = now() WHERE uid = $1`, [challengerUid]);

    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function setTrick(
  gameId: string,
  uid: string,
  trickName: string,
  videoUrl: string,
): Promise<{ matcherUid: string; setterUsername: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<GameRow>(`SELECT * FROM games WHERE id = $1 FOR UPDATE`, [gameId]);
    const game = rows[0];
    if (!game) throw new GameError(404, "Game not found");
    assertActive(game);
    assertCurrentTurn(game, uid);
    if (game.phase !== "setting") throw new GameError(409, "Game is not in setting phase");

    // Rate limit
    if (Date.now() - game.updated_at.getTime() < RATE_LIMIT_TURN_ACTION_MS) {
      throw new GameError(429, "Too fast — wait a moment");
    }

    const matcherUid = opponent(game, uid);

    await client.query(
      `UPDATE games SET
         current_trick_name = $2,
         current_trick_video_url = $3,
         phase = 'matching',
         current_turn = $4,
         match_video_url = NULL,
         turn_deadline = $5
       WHERE id = $1`,
      [gameId, trickName, videoUrl, matcherUid, deadlineFromNow()],
    );

    await client.query("COMMIT");

    const setterUsername = game.player1_uid === uid ? game.player1_username : game.player2_username;

    return { matcherUid, setterUsername };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function failSetTrick(gameId: string, uid: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<GameRow>(`SELECT * FROM games WHERE id = $1 FOR UPDATE`, [gameId]);
    const game = rows[0];
    if (!game) throw new GameError(404, "Game not found");
    assertActive(game);
    assertCurrentTurn(game, uid);
    if (game.phase !== "setting") throw new GameError(409, "Game is not in setting phase");

    if (Date.now() - game.updated_at.getTime() < RATE_LIMIT_TURN_ACTION_MS) {
      throw new GameError(429, "Too fast — wait a moment");
    }

    const nextSetter = opponent(game, uid);

    await client.query(
      `UPDATE games SET
         current_setter = $2,
         current_turn = $2,
         turn_number = turn_number + 1,
         current_trick_name = NULL,
         current_trick_video_url = NULL,
         match_video_url = NULL,
         turn_deadline = $3
       WHERE id = $1`,
      [gameId, nextSetter, deadlineFromNow()],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function submitMatchAttempt(
  gameId: string,
  uid: string,
  matchVideoUrl: string,
  landed: boolean,
): Promise<{
  gameOver: boolean;
  winner: string | null;
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<GameRow>(`SELECT * FROM games WHERE id = $1 FOR UPDATE`, [gameId]);
    const game = rows[0];
    if (!game) throw new GameError(404, "Game not found");
    assertActive(game);
    assertCurrentTurn(game, uid);
    if (game.phase !== "matching") throw new GameError(409, "Game is not in matching phase");

    if (Date.now() - game.updated_at.getTime() < RATE_LIMIT_TURN_ACTION_MS) {
      throw new GameError(429, "Too fast — wait a moment");
    }

    // Determine letter recipient
    let letterTo: string | null = null;
    let newP1 = game.p1_letters;
    let newP2 = game.p2_letters;

    if (!landed) {
      // Matcher gets a letter
      letterTo = uid;
      if (uid === game.player1_uid) {
        newP1 += 1;
      } else {
        newP2 += 1;
      }
    }

    // Record turn history
    const setterUid = game.current_setter;
    const setterUsername = setterUid === game.player1_uid ? game.player1_username : game.player2_username;
    const matcherUsername = uid === game.player1_uid ? game.player1_username : game.player2_username;

    await client.query(
      `INSERT INTO turn_history
         (game_id, turn_number, trick_name, setter_uid, setter_username,
          matcher_uid, matcher_username, set_video_url, match_video_url,
          landed, letter_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        gameId,
        game.turn_number,
        game.current_trick_name,
        setterUid,
        setterUsername,
        uid,
        matcherUsername,
        game.current_trick_video_url,
        matchVideoUrl,
        landed,
        letterTo,
      ],
    );

    const gameOver = newP1 >= 5 || newP2 >= 5;

    if (gameOver) {
      const winner = newP1 >= 5 ? game.player2_uid : game.player1_uid;
      await client.query(
        `UPDATE games SET
           p1_letters = $2, p2_letters = $3,
           match_video_url = $4,
           status = 'complete', winner = $5
         WHERE id = $1`,
        [gameId, newP1, newP2, matchVideoUrl, winner],
      );
      await client.query("COMMIT");
      return { gameOver: true, winner };
    }

    // Continue — same setter keeps setting, turn passes to setter
    await client.query(
      `UPDATE games SET
         p1_letters = $2, p2_letters = $3,
         match_video_url = $4,
         phase = 'setting',
         current_turn = $5,
         current_setter = $5,
         turn_number = turn_number + 1,
         current_trick_name = NULL,
         current_trick_video_url = NULL,
         turn_deadline = $6
       WHERE id = $1`,
      [gameId, newP1, newP2, matchVideoUrl, setterUid, deadlineFromNow()],
    );

    await client.query("COMMIT");
    return { gameOver: false, winner: null };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function forfeitExpiredTurn(gameId: string, uid: string): Promise<{ forfeited: string; winner: string }> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query<GameRow>(`SELECT * FROM games WHERE id = $1 FOR UPDATE`, [gameId]);
    const game = rows[0];
    if (!game) throw new GameError(404, "Game not found");
    assertActive(game);
    assertPlayer(game, uid);

    // Only the non-current-turn player can trigger forfeit
    if (game.current_turn === uid) {
      throw new GameError(403, "Cannot forfeit your own turn");
    }

    if (new Date() < game.turn_deadline) {
      throw new GameError(409, "Turn deadline has not passed yet");
    }

    const forfeited = game.current_turn;
    const winner = uid;

    await client.query(`UPDATE games SET status = 'forfeit', winner = $2 WHERE id = $1`, [gameId, winner]);

    await client.query("COMMIT");
    return { forfeited, winner };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
