import pool from "../db/pool.js";
import type { NotificationRow, NotificationType } from "../types/models.js";

export async function createNotification(
  recipientUid: string,
  type: NotificationType,
  title: string,
  body: string,
  gameId: string,
): Promise<NotificationRow> {
  const { rows } = await pool.query<NotificationRow>(
    `INSERT INTO notifications (recipient_uid, type, title, body, game_id)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [recipientUid, type, title, body, gameId],
  );
  return rows[0];
}

export async function getNotifications(uid: string, limit = 50): Promise<NotificationRow[]> {
  const { rows } = await pool.query<NotificationRow>(
    `SELECT * FROM notifications
     WHERE recipient_uid = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [uid, limit],
  );
  return rows;
}

export async function markRead(notificationId: string, uid: string): Promise<void> {
  const result = await pool.query(
    `UPDATE notifications SET read = true
     WHERE id = $1 AND recipient_uid = $2`,
    [notificationId, uid],
  );
  if (result.rowCount === 0) {
    throw new Error("Notification not found or not yours");
  }
}

export async function markAllRead(uid: string): Promise<void> {
  await pool.query(
    `UPDATE notifications SET read = true
     WHERE recipient_uid = $1 AND read = false`,
    [uid],
  );
}
