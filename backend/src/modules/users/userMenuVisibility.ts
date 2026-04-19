import { pool } from "../../db/pool";

export async function ensureUserMenuVisibilityColumns(): Promise<void> {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_senhas BOOLEAN NOT NULL DEFAULT TRUE`);
  await pool.query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_transacional BOOLEAN NOT NULL DEFAULT TRUE`,
  );
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_negocial BOOLEAN NOT NULL DEFAULT TRUE`);
}
