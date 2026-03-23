import pool from "../db/pool.js";
import type { UserRow } from "../types/models.js";

export async function createProfile(
  uid: string,
  username: string,
  stance: string,
  emailVerified: boolean,
  dob?: string,
  parentalConsent?: boolean,
): Promise<UserRow> {
  // Atomic: if username already taken the UNIQUE constraint will reject
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (uid, username, stance, email_verified, dob, parental_consent)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [uid, username.toLowerCase(), stance, emailVerified, dob ?? null, parentalConsent ?? null],
  );
  return rows[0];
}

export async function getProfile(uid: string): Promise<UserRow | null> {
  const { rows } = await pool.query<UserRow>(`SELECT * FROM users WHERE uid = $1`, [uid]);
  return rows[0] ?? null;
}

export async function getUidByUsername(username: string): Promise<string | null> {
  const { rows } = await pool.query<{ uid: string }>(`SELECT uid FROM users WHERE username = $1`, [
    username.toLowerCase(),
  ]);
  return rows[0]?.uid ?? null;
}

export async function updatePlayerStats(uid: string, gameId: string, won: boolean): Promise<void> {
  // Idempotent: skip if this game was already counted
  const col = won ? "wins" : "losses";
  await pool.query(
    `UPDATE users
     SET ${col} = ${col} + 1,
         last_stats_game_id = $2
     WHERE uid = $1
       AND (last_stats_game_id IS DISTINCT FROM $2)`,
    [uid, gameId],
  );
}

export async function getLeaderboard(limit = 50): Promise<Pick<UserRow, "uid" | "username" | "wins" | "losses">[]> {
  const { rows } = await pool.query(
    `SELECT uid, username, wins, losses
     FROM users
     ORDER BY wins DESC, losses ASC
     LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function deleteUserData(uid: string, username: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Delete games where user is a player (cascade deletes turn_history)
    await client.query(`DELETE FROM games WHERE player1_uid = $1 OR player2_uid = $1`, [uid]);
    // Delete user (cascade deletes fcm_tokens, notifications)
    await client.query(`DELETE FROM users WHERE uid = $1 AND username = $2`, [uid, username]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
