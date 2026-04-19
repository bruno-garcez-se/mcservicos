import { pool } from "../../db/pool";

export async function ensureCredentialAccessModeColumn(): Promise<void> {
  await pool.query(`ALTER TABLE credentials ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'web'`);
  await pool.query(`ALTER TABLE credentials ALTER COLUMN access_mode SET DEFAULT 'web'`);
  await pool.query(`UPDATE credentials SET access_mode = 'web' WHERE access_mode = 'online'`);
}
