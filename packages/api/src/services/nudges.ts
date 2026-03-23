import pool from "../db/pool.js";
import type { NudgeRow } from "../types/models.js";

const NUDGE_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export async function sendNudge(
  senderUid: string,
  senderUsername: string,
  recipientUid: string,
  gameId: string,
): Promise<NudgeRow> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Check rate limit
    const { rows: limitRows } = await client.query<{
      last_nudged_at: Date;
    }>(
      `SELECT last_nudged_at FROM nudge_limits
       WHERE sender_uid = $1 AND game_id = $2
       FOR UPDATE`,
      [senderUid, gameId],
    );

    if (limitRows[0]) {
      const elapsed = Date.now() - limitRows[0].last_nudged_at.getTime();
      if (elapsed < NUDGE_COOLDOWN_MS) {
        throw Object.assign(new Error("Nudge cooldown active"), {
          status: 429,
        });
      }
      await client.query(
        `UPDATE nudge_limits SET last_nudged_at = now()
         WHERE sender_uid = $1 AND game_id = $2`,
        [senderUid, gameId],
      );
    } else {
      await client.query(`INSERT INTO nudge_limits (sender_uid, game_id) VALUES ($1, $2)`, [senderUid, gameId]);
    }

    const { rows } = await client.query<NudgeRow>(
      `INSERT INTO nudges (sender_uid, sender_username, recipient_uid, game_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [senderUid, senderUsername, recipientUid, gameId],
    );

    await client.query("COMMIT");
    return rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
